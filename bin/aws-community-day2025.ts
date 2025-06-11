import KarpernterConstruct from "../lib/karpenter-construct"
import { configureApp } from "../lib/common/construct-utils/construct-utils"
import { KubernetesVersion } from "aws-cdk-lib/aws-eks"

const app = configureApp()
new KarpernterConstruct(app, "aws-communityday-2025", {
  kubernetesVersion: KubernetesVersion.V1_32,
  gitOpsRepo: "https://gitlab.com/parraletz/gitops-zero-to-platform-eng.git",
})
