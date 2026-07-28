AWS closes Bedrock Agents Classic to new customers on July 30. Most of the coverage reads like a retirement. It isn't. There is no end-of-life date, and if your account has called Bedrock Agents in the last 12 months, nothing about it changes for you.

---

The allowlist is automatic and per account. Activity in the past 12 months puts you on it. No activity, and CreateAgent starts returning AccessDeniedException, HTTP 403, on July 30. There is no exception process and no way to request one.

---

Per account is the part that bites in a multi-account org. The same Terraform or CDK module that provisions an agent in prod today will 403 in a brand new sandbox or a fresh environment account you stand up in August.

---

So the useful thing to do before the 30th is an inventory, not a migration. List which of your accounts have actually called Bedrock Agents in the last year. The gap between that list and the accounts you expect to provision into later is your real exposure.

---

What is genuinely frozen is the model catalog. Classic keeps the models it has today, and anything released after the 30th shows up only in AgentCore. That is the constraint worth planning a move around.
