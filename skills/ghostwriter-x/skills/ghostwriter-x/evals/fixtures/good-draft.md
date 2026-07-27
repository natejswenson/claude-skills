We cut our deploy rollback time from 25 minutes to 90 seconds.

The fix wasn't a new tool. It was deleting the approval step nobody read and
letting the health gate do its job.
---
The gate is three checks: error rate under 0.5%, p99 under 400ms, and zero
failed canary pods for 60 seconds. If any trip, traffic snaps back to the old
revision automatically.
---
The part that surprised us: the 60-second window matters more than the
thresholds. Shorter windows flapped on cold starts. Longer ones just delayed
the inevitable.
