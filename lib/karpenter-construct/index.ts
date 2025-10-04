import * as blueprints from "@aws-quickstart/eks-blueprints";
import { EksBlueprint } from "@aws-quickstart/eks-blueprints";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { IpFamily, KubernetesVersion } from "aws-cdk-lib/aws-eks";
import { Construct } from "constructs";
import { ArgoCDCoreAddOn } from "../addons/argocdcore/argocdcore";
import { ArgoRolloutsAddOn } from "../addons/argorollouts/argoRollouts";

interface EksCloudScoutsProps {
  kubernetesVersion: KubernetesVersion;
  gitOpsRepo?: string;
  gitOpsPath?: string;
  istioVersion?: string;
  istioValues?: any;
  platformTeams?: string[]; // Optional list of platform team role ARNs
  platformTeamArns?: string[]; // Additional ARNs for the platform team
  bootstrapAppsPath?: string; // Path to bootstrap apps in the gitOps repo
  bootstrapAppName?: string;
}

export default class KarpernterConstruct {
  constructor(scope: Construct, id: string, props: EksCloudScoutsProps) {
    const account = process.env.CDK_DEFAULT_ACCOUNT!;
    const region = process.env.CDK_DEFAULT_REGION!;
    const stackID = `${id}`;

    const ipFamily = IpFamily.IP_V4;

    const bootstrapRepo: blueprints.ApplicationRepository = {
      repoUrl: props.gitOpsRepo!,
    };
    const nodeClassSpec: blueprints.Ec2NodeClassV1Spec = {
      amiFamily: "Bottlerocket",
      amiSelectorTerms: [{ alias: "bottlerocket@latest" }],
      subnetSelectorTerms: [
        { tags: { Name: `${stackID}/${stackID}-vpc/PrivateSubnet*` } },
      ],
      securityGroupSelectorTerms: [
        { tags: { "aws:eks:cluster-name": `${stackID}` } },
      ],
    };

    const nodePoolSpec: blueprints.NodePoolV1Spec = {
      labels: { type: "aws-community-day" },
      annotations: {
        "eks-blueprints/owner": "parraletz",
      },
      requirements: [
        {
          key: "node.kubernetes.io/instance-type",
          operator: "In",
          values: ["m5.large", "t3.large"],
        },
        {
          key: "topology.kubernetes.io/zone",
          operator: "In",
          values: ["us-east-1a", "us-east-1b", "us-east-1c"],
        },
        {
          key: "kubernetes.io/arch",
          operator: "In",
          values: ["amd64", "arm64"],
        },
        { key: "karpenter.sh/capacity-type", operator: "In", values: ["spot"] },
      ],
      expireAfter: "1m",
      disruption: { consolidationPolicy: "WhenEmpty", consolidateAfter: "30s" },
    };

    const clusterProvider = new blueprints.GenericClusterProvider({
      version: props.kubernetesVersion,
      clusterName: stackID,
      managedNodeGroups: [
        {
          id: "managed-nodes",
          instanceTypes: [
            ec2.InstanceType.of(ec2.InstanceClass.M7I, ec2.InstanceSize.LARGE),
          ],
          maxSize: 2,
          minSize: 1,
        },
      ],
      fargateProfiles: {
        // karpenter: {
        //   fargateProfileName: "karpenter",
        //   selectors: [{ namespace: "karpenter-2" }],
        // },
        // argo: {
        //   fargateProfileName: "argocd",
        //   selectors: [
        //     {
        //       namespace: "argo-rollouts",
        //     },
        //   ],
        // },
      },
    });

    const addons: Array<blueprints.ClusterAddOn> = [
      new blueprints.addons.AwsLoadBalancerControllerAddOn({
        version: "1.13.2",
      }),
      new blueprints.addons.VpcCniAddOn({
        enableNetworkPolicy: true,
      }),
      new blueprints.addons.CoreDnsAddOn(),
      new blueprints.addons.KubeProxyAddOn(),
      new blueprints.addons.MetricsServerAddOn({
        name: "metrics-server",
      }),
      new blueprints.addons.KarpenterV1AddOn({
        nodePoolSpec,
        ec2NodeClassSpec: nodeClassSpec,
        interruptionHandling: true,
        namespace: "karpenter",
        values: {
          replicas: 1,
        },
      }),
      new blueprints.addons.IstioBaseAddOn({
        version: "1.26.1",
      }),
      new blueprints.addons.IstioControlPlaneAddOn({
        version: "1.26.1",
      }),
      new blueprints.addons.IstioIngressGatewayAddon({
        version: "1.26.1",
        namespace: "istio-ingress",
        createNamespace: true,
        values: {
          service: {
            annotations: {
              "service.beta.kubernetes.io/aws-load-balancer-type": "nlb",
              "service.beta.kubernetes.io/aws-load-balancer-scheme":
                "internet-facing",
            },
          },
        },
      }),
      // new blueprints.addons.NginxAddOn({
      //   version: "2.1.0",
      //   name: "ingress-nginx",
      // }),
      //   new blueprints.addons.SecretsStoreAddOn({
      //     name: "secret-store",
      //     values: {
      //       affinity: {
      //         nodeAffinity: {
      //           requiredDuringSchedulingIgnoredDuringExecution: {
      //             nodeSelectorTerms: [
      //               {
      //                 matchExpressions: [
      //                   {
      //                     key: "eks.amazonaws.com/compute-type",
      //                     operator: "NotIn",
      //                     values: ["fargate"],
      //                   },
      //                 ],
      //               },
      //             ],
      //           },
      //         },
      //       },
      //     },
      //   }),
      new ArgoRolloutsAddOn({
        namespace: "argo-rollouts",
        createNamespace: true,
        version: "2.39.6",
      }),

      // new blueprints.addons.ArgoCDAddOn({
      //   name: "argocd",
      //   namespace: "argocd",
      //   version: "8.0.17",
      //   values: {
      //     server: {
      //       extensions: {
      //         enabled: true,
      //         extensionList: [
      //           {
      //             name: "rollout-extension",
      //             env: [
      //               {
      //                 name: "EXTENSION_URL",
      //                 value:
      //                   "https://github.com/argoproj-labs/rollout-extension/releases/download/v0.3.7/extension.tar",
      //               },
      //             ],
      //           },
      //         ],
      //       },
      //     },
      //   },
      // }),
      new ArgoCDCoreAddOn({
        namespace: "argocd",
        version: "v3.0.6",
      }),
    ];

    // Create a builder
    const blueprintBuilder = EksBlueprint.builder()
      .account(account)
      .clusterProvider(clusterProvider)
      .region(region)
      .addOns(...addons);

    // Setup platform teams
    const userRoleArns: string[] = [];

    // Add roles from platformTeams if they exist
    if (props.platformTeams && props.platformTeams.length > 0) {
      userRoleArns.push(...props.platformTeams);
    }

    // Add additional ARNs if provided
    if (props.platformTeamArns && props.platformTeamArns.length > 0) {
      userRoleArns.push(...props.platformTeamArns);
    }

    // Only create the team if there's at least one ARN
    if (userRoleArns.length > 0) {
      const platformTeam = {
        name: "platform",
        userRoleArns: userRoleArns,
      };

      blueprintBuilder.teams(new blueprints.PlatformTeam(platformTeam));
    }

    // Build cluster
    const blueprint = blueprintBuilder.build(scope, stackID);

    // Create the bootstrap application if gitOpsRepo is provided
    if (props.gitOpsRepo) {
      // Get the actual EKS cluster from the blueprint
      const cluster = blueprint.getClusterInfo().cluster;

      // Create the Argo CD bootstrap application with the cluster
      // new BootstrapApp(scope, `${id}-bootstrap-app`, {
      //   repoUrl: props.gitOpsRepo,
      //   path: props.bootstrapAppsPath || "bootstrap",
      //   bootstrapAppName: props.bootstrapAppName,
      //   targetRevision: "main",
      //   namespace: "argocd",
      //   cluster: cluster,
      // })
    }
  }
}
