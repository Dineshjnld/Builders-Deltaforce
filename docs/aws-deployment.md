# AWS rollout for the shared account

From the PowerShell session holding the temporary AWS credentials, run the budget script first. It uses standard AWS credential resolution. The script verifies a recurring USD 100 monthly unblended cost budget filtered to `DeltaforceProject=AgentStudio` across services. It checks the email subscriber for actual 50%, 80%, 100% and forecasted 100% alerts. An untagged or unallocatable charge can escape this filter, and billing data is delayed. The billing administrator must activate the project cost allocation tag. [AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)

    py -3.13 scripts/aws-project-budget.py --email YOUR_ALERT_EMAIL
    ./scripts/aws-bedrock-profile.ps1 -AlertEmail YOUR_ALERT_EMAIL

The second command verifies the budget before creating a dedicated, tagged, on-demand regional Nova Lite application inference profile. It does not invoke a model or modify IAM. Some billing tag activations take time to appear after the first resource is tagged. [Application inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-create.html)

For the application's AWS runtime, use a dedicated execution role. Grant `bedrock:InvokeModel` on the verified profile ARN and the single source foundation-model ARN. On the foundation-model permission require `StringEquals` for `bedrock:InferenceProfileArn` equal to the exact project profile ARN. No UI role needs billing or Bedrock administrator rights. Use `STUDIO_INFERENCE_PROVIDER=bedrock` and set `STUDIO_BEDROCK_PROFILE_ARN` to that verified ARN. The default remains local inference. Both chat design and specialist execution use the same backend adapter. [IAM prerequisites](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html)

GitHub Actions tests and builds the container on pushes and pull requests without AWS credentials. The Amplify build specification publishes the command-centre HTML, CSS and JS. To connect Amplify, install its GitHub app for this repository only. The frontend uses relative `/api/` requests. Configure an HTTPS rewrite to the verified API origin and test login cookies end to end before enabling a production branch. A static deployment alone cannot run the command centre.

The API currently writes SQLite to disk. A managed container deployment needs durable storage, a tested backup and restore, and a single writer. An existing project-owned HTTPS API host with persistent storage avoids new backend infrastructure. Do not point this project at a shared department database. Tag any new billable project resource before use. No Amplify app, compute cluster, load balancer or CI deployment identity is created by these scripts.
