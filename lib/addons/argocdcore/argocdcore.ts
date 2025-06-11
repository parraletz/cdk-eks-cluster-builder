import { ClusterAddOn, ClusterInfo } from "@aws-quickstart/eks-blueprints"
import { Construct } from "constructs"
import * as eks from "aws-cdk-lib/aws-eks"
import * as cdk from "aws-cdk-lib"

export interface ArgoCDCoreAddOnProps {
  /**
   * The Kubernetes namespace where Argo CD will be installed.
   * @default "argocd"
   */
  namespace?: string

  /**
   * The version of Argo CD to install.
   * @default "v3.0.6"
   */
  version?: string

  /**
   * Whether to enable automatic cleanup when the CDK stack is destroyed.
   * @default true
   */
  cleanupEnabled?: boolean
}

/**
 * ArgoCDCoreAddOn is an EKS Blueprints add-on that installs Argo CD on an EKS cluster using the official manifests.
 *
 * Unlike the ArgoCDAddOn which uses Helm, this add-on applies the raw Kubernetes manifests directly from the
 * Argo CD GitHub repository. This approach ensures you get the exact same installation as you would by following
 * the official installation instructions.
 *
 * This add-on provides the following features:
 * - Installation of Argo CD using the official manifests
 * - Automatic cleanup when the CDK stack is destroyed
 *
 * @example
 * ```typescript
 * import { ArgoCDCoreAddOn } from './lib/addons/argocdcore/argocdcore';
 *
 * // Basic installation with default settings
 * const addons = [
 *   new ArgoCDCoreAddOn()
 * ];
 *
 * // Installation with custom settings
 * const addons = [
 *   new ArgoCDCoreAddOn({
 *     namespace: 'argocd',
 *     version: 'v3.0.6',
 *     cleanupEnabled: true
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
export class ArgoCDCoreAddOn implements ClusterAddOn {
  private readonly cleanupEnabled: boolean

  constructor(private props: ArgoCDCoreAddOnProps = {}) {
    this.cleanupEnabled = props.cleanupEnabled ?? true
  }

  deploy(clusterInfo: ClusterInfo): Promise<Construct> {
    const cluster = clusterInfo.cluster
    const namespace = this.props.namespace ?? "argocd"
    const version = this.props.version ?? "v3.0.6"

    // Create namespace for Argo CD
    const nsManifest = cluster.addManifest("argocd-namespace", {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name: namespace,
      },
    })

    const manifestUrl = `https://raw.githubusercontent.com/argoproj/argo-cd/refs/tags/${version}/manifests/install.yaml`

    // Create service account for the installation job
    const installerSA = cluster.addManifest("argocd-installer-sa", {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: {
        name: "argocd-installer",
        namespace: namespace,
      },
    })

    // Create role binding to give permissions to the service account
    const installerRoleBinding = cluster.addManifest("argocd-installer-rb", {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "ClusterRoleBinding",
      metadata: {
        name: "argocd-installer-rb",
      },
      subjects: [
        {
          kind: "ServiceAccount",
          name: "argocd-installer",
          namespace: namespace,
        },
      ],
      roleRef: {
        kind: "ClusterRole",
        name: "cluster-admin",
        apiGroup: "rbac.authorization.k8s.io",
      },
    })

    // Configure to apply the complete manifest during deployment
    const applyArgoCD = new eks.KubernetesManifest(cluster, "argocd-apply", {
      cluster: cluster,
      manifest: [
        {
          apiVersion: "batch/v1",
          kind: "Job",
          metadata: {
            name: "argocd-install-job",
            namespace: namespace,
          },
          spec: {
            template: {
              spec: {
                serviceAccountName: "argocd-installer",
                containers: [
                  {
                    name: "kubectl",
                    image: "bitnami/kubectl:latest",
                    command: ["/bin/sh", "-c"],
                    args: [`kubectl apply -f ${manifestUrl} -n ${namespace}`],
                  },
                ],
                restartPolicy: "Never",
              },
            },
            backoffLimit: 0,
          },
        },
      ],
    })

    // Set correct dependencies
    installerSA.node.addDependency(nsManifest)
    installerRoleBinding.node.addDependency(installerSA)
    applyArgoCD.node.addDependency(installerRoleBinding)

    // Add cleanup mechanism if enabled
    if (this.cleanupEnabled) {
      this.setupCleanupMechanism(cluster, namespace, applyArgoCD)
    }

    return Promise.resolve(applyArgoCD)
  }

  private setupCleanupMechanism(
    cluster: eks.ICluster,
    namespace: string,
    resource: Construct
  ): Construct {
    // Create a custom resource that will be executed during deletion
    const cleanupCR = new cdk.CustomResource(
      cluster,
      "argocd-core-cleanup-cr",
      {
        serviceToken: this.createCleanupProvider(cluster).serviceToken,
        properties: {
          // Include a timestamp to ensure the resource is updated each time
          timestamp: Date.now().toString(),
          namespace: namespace,
          clusterName: cluster.clusterName,
          region: cdk.Stack.of(cluster).region,
        },
        resourceType: "Custom::ArgoCDCoreCleanup",
      }
    )

    // Ensure cleanup runs after the main resource has been created
    cleanupCR.node.addDependency(resource)

    return cleanupCR
  }

  private createCleanupProvider(
    cluster: eks.ICluster
  ): cdk.custom_resources.Provider {
    // Create a lambda function to run cleanup task
    const fn = new cdk.aws_lambda.Function(
      cluster,
      "argocd-core-cleanup-lambda",
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
            
            logger.info(f"Starting ArgoCDCore cleanup in namespace {namespace}")
            
            # Configure kubectl to access the cluster
            subprocess.check_call(['aws', 'eks', 'update-kubeconfig', 
                                  '--name', cluster_name, 
                                  '--region', region])
            
            # Delete all ArgoCD resources
            try:
                logger.info(f"Deleting ArgoCD resources in namespace {namespace}")
                subprocess.check_call(['kubectl', 'delete', 'all', '--all', '-n', namespace])
                logger.info("Resources deleted successfully")
            except subprocess.CalledProcessError as e:
                logger.warning(f"Error deleting resources: {str(e)}")
            
            # Delete ArgoCD CRDs
            try:
                logger.info("Deleting ArgoCD CRDs")
                subprocess.check_call(['kubectl', 'delete', 'crd', '-l', 'app.kubernetes.io/part-of=argocd'])
                logger.info("CRDs deleted successfully")
            except subprocess.CalledProcessError as e:
                logger.warning(f"Error deleting CRDs: {str(e)}")
            
            # Delete the namespace if it exists
            try:
                logger.info(f"Deleting namespace {namespace}")
                subprocess.check_call(['kubectl', 'delete', 'namespace', namespace, '--ignore-not-found'])
                logger.info("Namespace deleted successfully")
            except subprocess.CalledProcessError as e:
                logger.warning(f"Error deleting namespace: {str(e)}")
            
            logger.info("ArgoCDCore cleanup completed")
            response_data['Message'] = "ArgoCDCore uninstalled successfully"
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
      "argocd-core-cleanup-provider",
      {
        onEventHandler: fn,
      }
    )
  }
}
