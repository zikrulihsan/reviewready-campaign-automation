# ReviewReady end-to-end test plan

Status: scenarios prepared; tests have not been run.

## Before testing

- Apply the pending Supabase migration, including `notification_delivery`.
- Deploy the current app and Netlify Functions. Notification environment variables are set in the Netlify production Functions context.
- In the imported n8n workflow, set `api_base_url` and `app_base_url` to `https://reviewready-campaign.netlify.app`, set the internal token credential, and activate the workflow.
- Confirm the existing Supabase Database Webhook targets the active n8n submission webhook.
- Use an inbox you control and synthetic campaign content/files only. This prototype has no login; do not use real identity or bank documents.

## Scenarios

### 1. Campaign enters the reviewer queue

1. Create a campaign with complete fields, clear story/use/delivery details, and an email inbox you control.
2. Submit without expedited review.
3. Wait for the n8n execution and refresh the creator/reviewer pages.

Expected:

- Campaign reaches `ready_for_review` or `ready_for_review_with_notes`.
- Reviewer Slack receives one message with a link to the campaign.
- Creator receives one email saying the campaign entered review.
- The notification table has one `sent` Slack row and one `sent` creator email row for the submission event.

If the model requests clarification, continue with Scenario 2 before expecting the queue notifications.

### 2. Automated clarification, then creator resubmission

Precondition: Gemini is configured and its analysis is available. If it is unavailable, the app intentionally routes the campaign onward with notes instead of asking the creator to revise.

1. Create a non-expedited campaign with a deliberately thin or placeholder story, such as `test`, and submit.
2. Confirm the campaign enters `action_required`.
3. Revise the story, use of funds, and delivery details, then resubmit.

Expected:

- After step 1, the creator receives a clarification email and no reviewer Slack message is sent yet.
- After step 3, the campaign enters the review queue; Slack and the creator queue email are sent once for the new submission event.

### 3. Creator chooses to submit as-is

1. Start from a campaign in `action_required`.
2. Choose **Submit as it is**.

Expected:

- The campaign proceeds to the reviewer queue with its notes attached.
- Reviewer Slack and creator queue email are sent once.
- Replaying the same n8n event does not create another outbox row or resend already-sent notifications.

### 4. Reviewer requests changes

1. From a queued campaign, choose **Request changes** and enter a clear note.
2. Confirm the creator receives an email containing that note.
3. Update the campaign and resubmit.

Expected:

- The campaign changes to `action_required` and the creator email is sent.
- On resubmission, the new event is processed by n8n, the campaign returns to the queue, and a new Slack alert plus queue email are sent.

### 5. Document rejection and publication

1. Upload a synthetic supporting file to a queued campaign.
2. As reviewer, reject it with a note; then replace it with a synthetic file and accept it.
3. Approve campaign content.
4. Upload and accept all document types shown as required in the UI. For a self/medical sample, that includes organizer ID, recent bank statement, and medical supporting evidence; use mock files only.
5. Complete the five manual checks with test data and publish.

Expected:

- Rejecting a file emails the creator with the reviewer note.
- Content approval emails the creator with the next steps.
- Publishing makes a live campaign page and emails the creator its link.

### 6. Delivery retry (run only in a safe test window)

1. In a staging or otherwise isolated test context, temporarily use an invalid SMTP credential and trigger a creator email.
2. Confirm the notification row becomes `failed` with an increased attempt count.
3. Restore the valid SMTP values and use Netlify's **Run now** action for `deliver-notifications` (or wait for the next run on a published production deploy).

Expected:

- The failed row is retried and becomes `sent` after the SMTP settings are restored.
- Do not deliberately break production SMTP settings while real notifications could be sent.

## Evidence to collect

- n8n execution result for each submission event.
- Creator and reviewer page status after each transition.
- Actual message in the controlled inbox and reviewer Slack channel.
- Supabase rows for the test campaign:

```sql
SELECT channel, notification_kind, delivery_status, attempts, provider_id, last_error, sent_at
FROM reviewready.notification_deliveries
WHERE campaign_id = '<test-campaign-id>'
ORDER BY created_at;
```
