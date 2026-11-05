# 0006: Pre-registered teacher-value rule

Status: proposed, awaiting approval.

## Decision

I must approve this rule before the first full benchmark run. Approval
freezes the rule and its thresholds; they cannot change after that first run.
The approved rule must be committed before the run.

For one dataset, budget and seed, the distilled rule beats an arm when its
held-out accuracy is higher and the exact McNemar test on the paired held-out
rows gives `RuleBetter` (two-sided, p < 0.05).

A dataset passes when, at budget 20 and at budget 50, the rule beats both
no-teacher arms (F15) in at least 5 of 10 seeds. The teacher-value rule is met
when at least 3 of the 6 datasets pass.

## Consequences

If the rule is not met, I will choose either to reposition the product
around live fill, the blind evaluation protocol and the certificate, with copy
saying the rule matches a tuned tree, or to pursue a different project.
