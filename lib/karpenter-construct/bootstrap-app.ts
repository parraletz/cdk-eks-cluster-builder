import { ICluster, KubernetesManifest } from "aws-cdk-lib/aws-eks"
import { Stack } from "aws-cdk-lib/core"
import { Construct } from "constructs"

export interface BootstrapAppProps {
  /**
   * The URL of the Git repository containing the application manifests
   */
  repoUrl: string

  /**
   * The path within the Git repository where the application manifests are located
   */
  path: string

  /**
   * The Git branch, tag, or commit to use
   */
  targetRevision?: string

  /**
   * The namespace where the Argo CD Application should be created
   */
  namespace?: string

  /**
   * The EKS cluster where the manifest will be applied
   */
  cluster: ICluster

  /**
   * The name for the application
   */
  bootstrapAppName?: string
}

/**
 * Creates an Argo CD Application manifest for bootstrapping applications
 */
export class BootstrapApp extends Construct {
  /**
   * The Kubernetes manifest for the Argo CD Application
   */
  public readonly k8sManifest: KubernetesManifest

  constructor(scope: Construct, id: string, props: BootstrapAppProps) {
    // We need to use the cluster's stack as the scope for the KubernetesManifest
    const stack = Stack.of(props.cluster)
    super(scope, id)

    const namespace = props.namespace || "argocd"
    const targetRevision = props.targetRevision || "main"

    // Create the Argo CD Application manifest
    // Use the cluster's stack as the scope for the KubernetesManifest
    this.k8sManifest = new KubernetesManifest(
      Stack.of(props.cluster),
      "BootstrapAppManifest",
      {
        cluster: props.cluster,
        manifest: [
          {
            apiVersion: "argoproj.io/v1alpha1",
            kind: "Application",
            metadata: {
              name: props.bootstrapAppName || "bootstrap-apps",
              namespace: namespace,
              annotations: {
                "argocd.argoproj.io/sync-wave": "0",
              },
            },
            spec: {
              destination: {
                namespace: namespace,
                server: "https://kubernetes.default.svc",
              },
              project: "default",
              source: {
                path: props.path,
                repoURL: props.repoUrl,
                targetRevision: targetRevision,
              },
              syncPolicy: {
                automated: {
                  allowEmpty: true,
                  prune: true,
                  selfHeal: true,
                },
              },
            },
          },
        ],
      }
    )
  }
}
