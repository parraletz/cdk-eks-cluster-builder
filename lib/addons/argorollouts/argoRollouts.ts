import { ClusterAddOn, ClusterInfo } from "@aws-quickstart/eks-blueprints"
import { Construct } from "constructs"
import * as eks from "aws-cdk-lib/aws-eks"
import * as cdk from "aws-cdk-lib"

export interface ArgoRolloutsAddOnProps {
  /**
   * The Kubernetes namespace where Argo Rollouts will be installed.
   * @default "argo-rollouts"
   */
  namespace?: string

  /**
   * The version of the Argo Rollouts Helm chart to install.
   * @default "2.32.0"
   */
  version?: string

  /**
   * Custom values to pass to the Helm chart.
   */
  values?: { [key: string]: any }

  /**
   * Whether to create the namespace if it doesn't exist.
   * @default true
   */
  createNamespace?: boolean

  /**
   * Whether to enable automatic cleanup when the CDK stack is destroyed.
   * @default true
   */
  cleanupEnabled?: boolean
}

/**
 * ArgoRolloutsAddOn is an EKS Blueprints add-on that installs Argo Rollouts on an EKS cluster using the official Helm chart.
 *
 * Argo Rollouts is a Kubernetes controller and set of CRDs which provide advanced deployment capabilities
 * such as blue-green, canary, canary analysis, experimentation, and progressive delivery features to Kubernetes.
 *
 * This add-on provides the following features:
 * - Installation of Argo Rollouts using the official Helm chart
 * - Customization of the installation through Helm values
 * - Automatic cleanup when the CDK stack is destroyed
 *
 * @example
 * ```typescript
 * import { ArgoRolloutsAddOn } from './lib/addons/argorollouts/argoRollouts';
 *
 * // Basic installation with default settings
 * const addons = [
 *   new ArgoRolloutsAddOn()
 * ];
 *
 * // Installation with custom settings
 * const addons = [
 *   new ArgoRolloutsAddOn({
 *     namespace: 'argo-rollouts',
 *     version: '2.32.0',
 *     createNamespace: true,
 *     cleanupEnabled: true,
 *     values: {
 *       dashboard: {
 *         enabled: true
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
export class ArgoRolloutsAddOn implements ClusterAddOn {
  private readonly cleanupEnabled: boolean

  constructor(private props: ArgoRolloutsAddOnProps = {}) {
    this.cleanupEnabled = props.cleanupEnabled ?? true
  }

  deploy(clusterInfo: ClusterInfo): Promise<Construct> {
    const cluster = clusterInfo.cluster
    const namespace = this.props.namespace ?? "argo-rollouts"
    const version = this.props.version ?? "2.32.0" // Current version of the Helm chart
    const createNamespace = this.props.createNamespace ?? true

    let chart: eks.HelmChart
    let mainResource: Construct

    if (createNamespace) {
      // Create namespace for Argo Rollouts
      const nsManifest = cluster.addManifest("argo-rollouts-namespace", {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: {
          name: namespace,
        },
      })

      // Install Argo Rollouts using Helm
      chart = cluster.addHelmChart("argo-rollouts", {
        repository: "https://argoproj.github.io/argo-helm",
        chart: "argo-rollouts",
        release: "argo-rollouts",
        namespace: namespace,
        version: version,
        values: this.props.values,
      })

      chart.node.addDependency(nsManifest)
      mainResource = chart
    } else {
      // Install Argo Rollouts using Helm without creating namespace
      chart = cluster.addHelmChart("argo-rollouts", {
        repository: "https://argoproj.github.io/argo-helm",
        chart: "argo-rollouts",
        release: "argo-rollouts",
        namespace: namespace,
        version: version,
        values: this.props.values,
      })
      mainResource = chart
    }

    // Add cleanup mechanism if enabled
    if (this.cleanupEnabled) {
      mainResource = this.setupCleanupMechanism(cluster, namespace, chart)
    }

    return Promise.resolve(mainResource)
  }

  private setupCleanupMechanism(
    cluster: eks.ICluster,
    namespace: string,
    chart: eks.HelmChart
  ): Construct {
    // Create a custom resource that will be executed during deletion
    const cleanupCR = new cdk.CustomResource(
      cluster,
      "argo-rollouts-cleanup-cr",
      {
        serviceToken: this.createCleanupProvider(cluster).serviceToken,
        properties: {
          // Include a timestamp to ensure the resource is updated each time
          timestamp: Date.now().toString(),
          namespace: namespace,
          releaseName: "argo-rollouts",
          clusterName: cluster.clusterName,
          region: cdk.Stack.of(cluster).region,
        },
        resourceType: "Custom::ArgoRolloutsCleanup",
      }
    )

    // Ensure cleanup runs after the chart has been created
    cleanupCR.node.addDependency(chart)

    return cleanupCR
  }

  private createCleanupProvider(
    cluster: eks.ICluster
  ): cdk.custom_resources.Provider {
    // Create a Lambda function that will execute the helm uninstall command
    const fn = new cdk.aws_lambda.Function(
      cluster,
      "argo-rollouts-cleanup-lambda",
      {
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
            
            logger.info(f"Starting Argo Rollouts uninstallation: {release_name} in namespace {namespace}")
            
            # Configure kubectl to access the cluster
            subprocess.check_call(['aws', 'eks', 'update-kubeconfig', 
                                  '--name', cluster_name, 
                                  '--region', region])
            
            # Uninstall Argo Rollouts using Helm
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
            
            logger.info("Argo Rollouts cleanup completed")
            response_data['Message'] = "Argo Rollouts uninstalled successfully"
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
      }
    )

    // Add necessary permissions for the Lambda function
    fn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["eks:DescribeCluster", "eks:ListClusters"],
        resources: ["*"],
      })
    )

    // Create a custom provider for the resource
    return new cdk.custom_resources.Provider(
      cluster,
      "argo-rollouts-cleanup-provider",
      {
        onEventHandler: fn,
      }
    )
  }
}
