"""Create or verify the Agent Studio budget using the caller's current AWS CLI session."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

NAME = "deltaforce-agent-studio-monthly"
TAG = {"Key": "DeltaforceProject", "Values": ["AgentStudio"]}
BUDGET = {
    "BudgetName": NAME, "BudgetLimit": {"Amount": "100", "Unit": "USD"},
    "BudgetType": "COST", "TimeUnit": "MONTHLY",
    "FilterExpression": {"Tags": TAG}, "Metrics": ["UnblendedCost"],
}

def budgets(email):
    return [{"Notification": {"NotificationType": kind, "ComparisonOperator": "GREATER_THAN",
                             "Threshold": threshold, "ThresholdType": "PERCENTAGE"},
             "Subscribers": [{"SubscriptionType": "EMAIL", "Address": email}]}
            for kind, threshold in [("ACTUAL", 50), ("ACTUAL", 80), ("ACTUAL", 100), ("FORECASTED", 100)]]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--plan", action="store_true", help="Render the request without contacting AWS")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    alerts = budgets(args.email)
    request = {"Budget": BUDGET, "NotificationsWithSubscribers": alerts}
    if args.plan:
        print(json.dumps(request, indent=2))
        return
    cli = shutil.which("aws") or str(Path(os.getenv("ProgramFiles", "")) / "Amazon/AWSCLIV2/aws.exe")
    env = {**os.environ, "AWS_PAGER": "", "AWS_EC2_METADATA_DISABLED": "true"}
    def aws(*arguments, missing_ok=False):
        result = subprocess.run([cli, *arguments, "--output", "json", "--region", "us-east-1"],
                                env=env, capture_output=True, text=True)
        if result.returncode:
            if missing_ok and "(NotFoundException)" in result.stderr:
                return None
            raise SystemExit(result.stderr.strip())
        return json.loads(result.stdout) if result.stdout.strip() else {}
    account = aws("sts", "get-caller-identity")["Account"]
    parameters = ["--account-id", account, "--budget-name", NAME]
    current = aws("budgets", "describe-budget", *parameters, missing_ok=True)
    if current is None:
        if args.verify_only:
            raise SystemExit("Project budget has not been created.")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "budget.json"
            path.write_text(json.dumps({**request, "AccountId": account}), encoding="utf-8")
            aws("budgets", "create-budget", "--cli-input-json", "file://" + str(path))
        current = aws("budgets", "describe-budget", *parameters)
    found = current["Budget"]
    expr = found.get("FilterExpression", {})
    tag = expr.get("Tags", {})
    if not (found["BudgetType"] == "COST" and found["TimeUnit"] == "MONTHLY"
            and float(found["BudgetLimit"]["Amount"]) == 100 and found["BudgetLimit"]["Unit"] == "USD"
            and set(expr) == {"Tags"} and tag.get("Key") == TAG["Key"] and tag.get("Values") == TAG["Values"]
            and set(tag.get("MatchOptions", [])) <= {"EQUALS", "CASE_SENSITIVE"}
            and found.get("Metrics") == ["UnblendedCost"]):
        raise SystemExit("Existing budget differs from the requested scope. It was left untouched.")
    notices = aws("budgets", "describe-notifications-for-budget", *parameters)["Notifications"]
    for alert in alerts:
        notice = alert["Notification"]
        if not any(all(n.get(k) == v for k, v in notice.items()) for n in notices):
            raise SystemExit("Budget exists but an expected alert is missing.")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "notification.json"
            path.write_text(json.dumps(notice), encoding="utf-8")
            subs = aws("budgets", "describe-subscribers-for-notification", *parameters,
                       "--notification", "file://" + str(path))["Subscribers"]
        if alert["Subscribers"][0] not in subs:
            raise SystemExit("Budget exists but the expected subscriber is missing.")
    print("Verified project budget: USD 100 monthly, DeltaforceProject=AgentStudio, four email alerts.")

if __name__ == "__main__":
    main()
