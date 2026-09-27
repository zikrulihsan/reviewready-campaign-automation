# Live presentation drafts

Seven synthetic campaigns are saved as **drafts** at [ReviewReady](https://reviewready-campaign.netlify.app). None has been submitted. The creator email is blank in every draft, so the presenter can enter a controlled test inbox before submitting. All people and documents are fictional.

| Order | Draft | Intended AI feedback | What to show |
| --- | --- | --- | --- |
| 01 | [Maya's school supplies](https://reviewready-campaign.netlify.app/creator/campaign/ba5c8b68-a08b-453f-a92a-5fa9df757e43) | No urgent creator tip; ready for human review | A complete request can move ahead without mandatory AI advice. |
| 02 | [Noor's rent support](https://reviewready-campaign.netlify.app/creator/campaign/21dd8a9c-d21d-462b-9a5b-8a287a26d508) | One precise tip: the $2,600 goal exceeds listed costs of $2,400 by $200 | Specific, neutral feedback with a clear edit. |
| 03 | [Family support request](https://reviewready-campaign.netlify.app/creator/campaign/27e9de40-dc17-4fb2-a97c-498151f80729) | Foundational guidance about need, costs, beneficiary, and delivery | Several useful tips appear when more than two are truly needed. |
| 04 | [Lina's school supplies](https://reviewready-campaign.netlify.app/creator/campaign/2c08ce0c-1f00-4479-bc26-eda9e868b7cc) | Title and category conflict with rent-only story | The system asks for alignment without judging intent. |
| 05 | [Omar's therapy sessions](https://reviewready-campaign.netlify.app/creator/campaign/94f4210c-80a1-4e9a-a649-b8b81fceb01b) | One focused question about how money reaches Omar or the provider | A delivery gap distinct from a funding gap. |
| 06 | [Community emergency supplies](https://reviewready-campaign.netlify.app/creator/campaign/5bf47ed7-cfd1-40c9-9b9b-699ab2d34070) | Missing relationship, unclear remaining costs, unclear funds path | Multiple distinct gaps ordered by urgency. |
| 07 | [Nia's tutoring support](https://reviewready-campaign.netlify.app/creator/campaign/e4b8875b-5019-412b-ada1-05c0445a19b2) | Attached PDF describes a bicycle repair quote, not tutoring | Reviewer opens the real sample file and assesses relevance manually. |

In the live rehearsal, **01** returned `ready` with no tips, **02** returned one precise $200 tip, **03** returned five foundational tips, **04** returned one focused contradiction tip, **05** returned one delivery tip, and **06** returned three distinct tips. The story in **07** was clarified after its initial readiness check; its PDF is attached and its document-relevance outcome should be observed after submission. AI wording can change between runs.

## Suggested live sequence

1. Start with **01**. Open the draft, use **Next** to reach **Submit campaign**, enter an email address controlled by the presentation team, and submit. Wait for preparation to finish, then open [the reviewer queue](https://reviewready-campaign.netlify.app/reviewer/queue). “Ready” means ready for a human decision, not approved or verified.
2. Open **02** and submit to show a single detailed AI suggestion. Edit the goal to $2,400 or explain the extra $200, then resubmit to show the feedback can clear. If you want to demonstrate **human** feedback too, use a campaign that has reached the reviewer queue, choose **Request changes**, enter a specific note, and reload its creator view.
3. Submit **03** for foundational guidance and **04** for an explicit contradiction. **05** is a shorter example of a single funds-path question. Use **06** when showing why tips are not limited to two.
4. Submit **07** last. In reviewer detail, open `TEST_ONLY_bicycle_repair_quote.pdf`; it is a synthetic PDF. The AI can flag relevance, but the reviewer makes the document decision. Model availability and wording can vary.

Each submit starts asynchronous processing and can queue email or Slack notifications. Use only a team-controlled test inbox. The drafts do not contain email addresses, and no notification has been queued by creating or checking them.

The exact source text for every draft is in [presentation-fixtures.json](presentation-fixtures.json). The live IDs and last observed readiness output are in [presentation-live-drafts.json](presentation-live-drafts.json).
