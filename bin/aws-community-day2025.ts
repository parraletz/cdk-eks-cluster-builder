import { KubernetesVersion } from "aws-cdk-lib/aws-eks";
import { configureApp } from "../lib/common/construct-utils/construct-utils";
import KarpernterConstruct from "../lib/karpenter-construct";

const app = configureApp();
new KarpernterConstruct(app, "aws-communityday-2025", {
  kubernetesVersion: KubernetesVersion.V1_33,
  gitOpsRepo: "https://gitlab.com/parraletz/gitops-zero-to-platform-eng.git",
  gitOpsPath: "bootstrap",
  platformTeamArns: ["arn:aws:iam::664418956352:user/aparra"],
  bootstrapAppName: "bootstrap-aws-communityday-2025",
});
