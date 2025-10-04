import { ClusterAddOn, ClusterInfo } from "@aws-quickstart/eks-blueprints";
import { Construct } from "constructs";
import * as eks from "aws-cdk-lib/aws-eks";
import * as cdk from "aws-cdk-lib";

export interface ArgoCDAddOnProps {
  /**
   * The Kubernetes namespace where Argo CD will be installed.
   * @default "argocd"
   */
  namespace?: string;

  /**
   * The version of the Argo CD Helm chart to install.
   * @default "5.51.4"
   */
  version?: string;

  /**
   * Custom values to pass to the Helm chart.
   */
  values?: { [key: string]: any };

  /**
   * Whether to create the namespace if it doesn't exist.
   * @default true
   */
  createNamespace?: boolean;

  /**
   * Whether to enable automatic cleanup when the CDK stack is destroyed.
   * @default true
   */
  cleanupEnabled?: boolean;
}

/**
 * ArgoCDAddOn is an EKS Blueprints add-on that installs Argo CD on an EKS cluster using the official Helm chart.
 *
 * Argo CD is a declarative, GitOps continuous delivery tool for Kubernetes that follows the GitOps pattern of using
 * Git repositories as the source of truth for defining the desired application state.
 *
 * This add-on provides the following features:
 * - Installation of Argo CD using the official Helm chart
 * - Customization of the installation through Helm values
 * - Automatic cleanup when the CDK stack is destroyed
 *
 * @example
 * ```typescript
 * import { ArgoCDAddOn } from './lib/addons/argocd/argocd';
 *
 * // Basic installation with default settings
 * const addons = [
 *   new ArgoCDAddOn()
 * ];
 *
 * // Installation with custom settings
 * const addons = [
 *   new ArgoCDAddOn({
 *     namespace: 'argocd',
 *     version: '5.51.4',
 *     createNamespace: true,
 *     cleanupEnabled: true,
 *     values: {
 *       server: {
 *         service: {
 *           type: 'LoadBalancer'
 *         }
 *       },
 *       configs: {
 *         secret: {
 *           argocdServerAdminPassword: '$2a$10$H7qXhRxIyXnWHgNHcM9wROxgZH7eurWQ5QHbPa.tJYZJ/K.OQ1Z92' // bcrypt hash of 'password'
 *         }
 *       }
 *     }
 *   })
 * ];
 *
 * EksBlueprint.builder()
 *   .account(account)
 *   .region(region)
 *   .addOns(...addons)
 *   .build(scope, 'eks-blueprint');
 * ```
 */
export class ArgoCDAddOn implements ClusterAddOn {
  private readonly cleanupEnabled: boolean;

  constructor(private props: ArgoCDAddOnProps = {}) {
    this.cleanupEnabled = props.cleanupEnabled ?? true;
  }

  deploy(clusterInfo: ClusterInfo): Promise<Construct> {
    const cluster = clusterInfo.cluster;
    const namespace = this.props.namespace ?? "argocd";
    const version = this.props.version ?? "5.51.4"; // Current version of the Helm chart
    const createNamespace = this.props.createNamespace ?? true;

    let chart: eks.HelmChart;
    let mainResource: Construct;

    if (createNamespace) {
      // Create namespace for Argo CD
      const nsManifest = cluster.addManifest("argocd-namespace", {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: {
          name: namespace,
        },
      });

      // Install Argo CD using Helm
      chart = cluster.addHelmChart("argocd", {
        repository: "https://argoproj.github.io/argo-helm",
        chart: "argo-cd",
        release: "argocd",
        namespace: namespace,
        version: version,
        values: this.props.values,
      });

      chart.node.addDependency(nsManifest);
      mainResource = chart;
    } else {
      // Install Argo CD using Helm without creating namespace
      chart = cluster.addHelmChart("argocd", {
        repository: "https://argoproj.github.io/argo-helm",
        chart: "argo-cd",
        release: "argocd",
        namespace: namespace,
        version: version,
        values: this.props.values,
      });
      mainResource = chart;
    }

    // Add cleanup mechanism if enabled
    if (this.cleanupEnabled) {
      mainResource = this.setupCleanupMechanism(cluster, namespace, chart);
    }

    return Promise.resolve(mainResource);
  }

  private setupCleanupMechanism(
    cluster: eks.ICluster,
    namespace: string,
    chart: eks.HelmChart,
  ): Construct {
    // Create a custom resource that will be executed during deletion
    const cleanupCR = new cdk.CustomResource(cluster, "argocd-cleanup-cr", {
      serviceToken: this.createCleanupProvider(cluster).serviceToken,
      properties: {
        // Include a timestamp to ensure the resource is updated each time
        timestamp: Date.now().toString(),
        namespace: namespace,
        releaseName: "argocd",
        clusterName: cluster.clusterName,
        region: cdk.Stack.of(cluster).region,
      },
      resourceType: "Custom::ArgoCDCleanup",
    });

    // Ensure cleanup runs after the chart has been created
    cleanupCR.node.addDependency(chart);

    return cleanupCR;
  }

  private createCleanupProvider(
    cluster: eks.ICluster,
  ): cdk.custom_resources.Provider {
    // Create a Lambda function that will execute the helm uninstall command
    const fn = new cdk.aws_lambda.Function(cluster, "argocd-cleanup-lambda", {
      runtime: cdk.aws_lambda.Runtime.PYTHON_3_9,
      handler: "index.handler",
      code: cdk.aws_lambda.Code.fromInline(`
import boto3
import cfnresponse
import subprocess
import os
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    logger.info(f"Received event: {event}")
    response_data = {}
    
    try:
        request_type = event['RequestType']
        properties = event['ResourceProperties']
        
        # Only run cleanup when the resource is being deleted
        if request_type == 'Delete':
            cluster_name = properties['clusterName']
            region = properties['region']
            namespace = properties['namespace']
            release_name = properties['releaseName']
            
            logger.info(f"Starting ArgoCD uninstallation: {release_name} in namespace {namespace}")
            
            # Configure kubectl to access the cluster
            subprocess.check_call(['aws', 'eks', 'update-kubeconfig', 
                                  '--name', cluster_name, 
                                  '--region', region])
            
            # Uninstall Argo CD using Helm
            try:
                logger.info(f"Executing helm uninstall {release_name} -n {namespace}")
                subprocess.check_call(['helm', 'uninstall', release_name, '-n', namespace])
                logger.info("Helm uninstall completed successfully")
            except subprocess.CalledProcessError as e:
                logger.warning(f"Error uninstalling Helm chart: {str(e)}")
                # Continue with namespace deletion even if uninstallation fails
            
            # Delete the namespace if it exists
            try:
                logger.info(f"Deleting namespace {namespace}")
                subprocess.check_call(['kubectl', 'delete', 'namespace', namespace, '--ignore-not-found'])
                logger.info("Namespace deleted successfully")
            except subprocess.CalledProcessError as e:
                logger.warning(f"Error deleting namespace: {str(e)}")
            
            logger.info("ArgoCD cleanup completed")
            response_data['Message'] = "ArgoCD uninstalled successfully"
        else:
            # For Create and Update, simply return success
            logger.info(f"Operation {request_type} - no action required")
            response_data['Message'] = f"Operation {request_type} processed"
        
        cfnresponse.send(event, context, cfnresponse.SUCCESS, response_data)
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        cfnresponse.send(event, context, cfnresponse.FAILED, {"Error": str(e)})
`),
      timeout: cdk.Duration.minutes(15),
    });

    // Add necessary permissions for the Lambda function
    fn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["eks:DescribeCluster", "eks:ListClusters"],
        resources: ["*"],
      }),
    );

    // Create a custom provider for the resource
    return new cdk.custom_resources.Provider(
      cluster,
      "argocd-cleanup-provider",
      {
        onEventHandler: fn,
      },
    );
  }
}
