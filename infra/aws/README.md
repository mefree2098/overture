# AWS deployment

The `aws` target in [deploy.sh](/Users/mattfreestone/Documents/Overture/deploy.sh) provisions a single Amazon EC2 host, publishes the container image to ECR, and starts Overture with persistent runtime state under `/opt/overture/runtime`.

## Required environment

- `OPENAI_API_KEY`

AWS credentials and region resolution can come from the normal AWS CLI chain. Set `AWS_REGION` if your default profile does not already have one.

## Optional environment

- `AWS_STACK_NAME` default `overture-control-plane`
- `AWS_REGION` or `AWS_DEFAULT_REGION`
- `AWS_INSTANCE_TYPE` default `t3.xlarge`
- `AWS_APP_ALLOWED_CIDR` default `0.0.0.0/0`
- `AWS_ECR_REPOSITORY` default `overture-control-plane`
- `OVERTURE_IMAGE_TAG` default current UTC timestamp

## One-command flow

```bash
AWS_REGION=us-west-2 OPENAI_API_KEY=sk-live-... bash deploy.sh aws
```

What the script does:

1. Creates or reuses an ECR repository.
2. Builds and pushes a `linux/amd64` image with Docker buildx.
3. Provisions the VPC, public subnet, security group, IAM instance profile, EC2 instance, and Elastic IP from [template.yaml](/Users/mattfreestone/Documents/Overture/infra/aws/template.yaml).
4. Waits for the instance health checks and SSM agent.
5. Uses AWS Systems Manager Run Command to pull the new image and restart the Overture container.
6. Waits for `GET /api/health` before exiting.

## Runtime notes

- The cloud deployment forces `OVERTURE_DEFAULT_EXECUTION_MODE=hosted_api`.
- This is intentionally a single-instance deployment because Overture persists SQLite and `.overture` runtime state locally.
- Port `3000` is exposed directly. Add a load balancer, reverse proxy, or TLS layer if you need HTTPS.
