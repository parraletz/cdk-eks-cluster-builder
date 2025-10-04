# AWS Community Day 2025 - EKS Platform Engineering

This project demonstrates a comprehensive platform engineering solution for AWS EKS (Elastic Kubernetes Service) using AWS CDK and EKS Blueprints. It showcases modern Kubernetes platform patterns including GitOps, service mesh, autoscaling, and progressive delivery.

## 🏗️ Architecture Overview

This platform engineering solution provides:

- **EKS Cluster**: Kubernetes cluster with managed and Fargate node groups
- **Karpenter**: Just-in-time node provisioning for optimal cost and performance
- **Istio Service Mesh**: Traffic management, security, and observability
- **ArgoCD**: GitOps continuous deployment
- **Argo Rollouts**: Progressive delivery and canary deployments
- **AWS Load Balancer Controller**: Intelligent load balancing for Kubernetes services
- **Bottlerocket OS**: Security-optimized container host OS

## 🚀 Key Features

### Infrastructure as Code

- Built with AWS CDK and TypeScript
- Uses EKS Blueprints for standardized cluster configurations
- Modular add-on architecture for extensibility

### GitOps Integration

- ArgoCD for declarative continuous deployment
- Bootstrap applications from Git repositories
- Automated synchronization of desired state

### Autoscaling & Cost Optimization

- Karpenter for intelligent node autoscaling
- Spot instance support for cost savings
- Bottlerocket AMI for enhanced security and performance

### Service Mesh & Traffic Management

- Istio service mesh with ingress gateway
- Network policies with VPC CNI
- Load balancing with AWS Load Balancer Controller

### Progressive Delivery

- Argo Rollouts for canary and blue-green deployments
- Integration with Istio for traffic splitting
- Automated rollback capabilities

## 📁 Project Structure

```
├── bin/
│   └── eks-builder.ts              # CDK app entry point
├── lib/
│   ├── addons/
│   │   ├── argocd/                 # ArgoCD add-on implementation
│   │   ├── argocdcore/             # ArgoCD core components
│   │   └── argorollouts/           # Argo Rollouts add-on
│   ├── common/
│   │   └── construct-utils/        # Common utilities and helpers
│   ├── karpenter-construct/        # Main EKS cluster construct
│   │   ├── index.ts               # Cluster configuration
│   │   └── bootstrap-app.ts       # GitOps bootstrap application
│   └── eks-builder-stack.ts       # CDK stack definition
└── test/                          # Unit tests
```

## 🛠️ Components

### Core Infrastructure

- **EKS Cluster**: Kubernetes v1.33 with managed nodes and Fargate profiles
- **VPC**: Multi-AZ setup with public and private subnets
- **IAM**: Platform team roles and service account configurations

### Add-ons

- **Karpenter v1**: Node autoscaling with Bottlerocket AMI
- **Istio**: Service mesh with base, control plane, and ingress gateway
- **ArgoCD**: GitOps continuous deployment platform
- **Argo Rollouts**: Progressive delivery controller
- **AWS Load Balancer Controller**: Native AWS load balancing
- **Metrics Server**: Resource metrics for autoscaling
- **VPC CNI**: Advanced networking with network policies

### Custom Add-ons

- **ArgoCDAddOn**: Enhanced ArgoCD deployment with cleanup mechanisms
- **ArgoRolloutsAddOn**: Argo Rollouts with custom configurations
- **ArgoCDCoreAddOn**: Core ArgoCD components

## 🚀 Getting Started

### Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js and npm installed
- AWS CDK CLI installed (`npm install -g aws-cdk`)
- kubectl installed for cluster interaction

### Environment Setup

```bash
export CDK_DEFAULT_ACCOUNT=<your-aws-account-id>
export CDK_DEFAULT_REGION=<your-preferred-region>
```

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd aws-community-day2025

# Install dependencies
npm install

# Compile TypeScript
npm run build
```

### Deployment

```bash
# Bootstrap CDK (first time only)
cdk bootstrap

# Deploy the EKS platform
cdk deploy

# Get cluster credentials
aws eks update-kubeconfig --name eks-builder-stack --region $CDK_DEFAULT_REGION
```

### Verification

```bash
# Check cluster status
kubectl get nodes

# Check installed add-ons
kubectl get pods --all-namespaces

# Access ArgoCD UI (after port-forwarding)
kubectl port-forward svc/argocd-server -n argocd 8080:443
```

## 🔧 Configuration

### GitOps Configuration

The platform is configured to work with a GitOps repository:

- **Repository**: `https://gitlab.com/parraletz/gitops-zero-to-platform-eng.git`
- **Path**: `bootstrap`
- **Application Name**: `bootstrap-eks-builder`

### Node Configuration

- **Instance Types**: m5.large, t3.large
- **Capacity Type**: Spot instances for cost optimization
- **AMI**: Bottlerocket (latest)
- **Architecture**: AMD64 and ARM64 support

### Networking

- **Service Mesh**: Istio with ingress gateway
- **Load Balancer**: AWS Network Load Balancer
- **IP Family**: IPv4
- **CNI**: VPC CNI with network policies enabled

## 📚 Usage Examples

### Deploying Applications

Applications are deployed through ArgoCD using GitOps principles. Add your application manifests to the configured Git repository.

### Scaling Configuration

Karpenter automatically provisions nodes based on pod requirements. Configure node pools in the `nodePoolSpec` for specific workload needs.

### Traffic Management

Use Istio virtual services and destination rules for advanced traffic management and progressive deployments.

## 🧪 Testing

```bash
# Run unit tests
npm run test

# Run CDK diff to see changes
cdk diff

# Validate CDK synthesis
cdk synth
```

## 📋 Available Commands

- `npm run build` - Compile TypeScript to JavaScript
- `npm run watch` - Watch for changes and compile
- `npm run test` - Run Jest unit tests
- `cdk deploy` - Deploy the stack to AWS
- `cdk diff` - Compare deployed stack with current state
- `cdk synth` - Generate CloudFormation template
- `cdk destroy` - Remove the deployed stack

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## 🏷️ Tags

`aws` `eks` `kubernetes` `platform-engineering` `gitops` `argocd` `karpenter` `istio` `cdk` `typescript`
