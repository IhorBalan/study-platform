A product manager wants to ship "ticket summaries" next sprint and asks you to review the design before it goes live. Write a review of 600 to 1000 words that the team can act on.

## The proposed design

The app is a multi-tenant help desk. About 300 companies use it and together they receive about 40,000 tickets a day.

- When a ticket arrives, the backend sends the model one request: a system prompt of about 2,500 tokens (tone rules, the summary format, twenty examples), followed by the ticket subject, the body, the text extracted from attachments, and the customer's last five CRM notes. A typical request is 4,000 input tokens.
- The model answers in Markdown: a three-line summary, a suggested priority and a "suggested reply" draft. The answer is stored on the ticket and rendered with a Markdown component in the agent's browser, which also displays images.
- The call uses the provider's default timeout and the SDK's default retries. Failures are logged together with the full request so that they can be debugged.
- A planned second phase adds a tool so the model can close duplicate tickets on its own.
- Quality was checked by the developer, who tried ten tickets and found the summaries "really good".
- Before launch, the team wants to summarise the 2 million existing tickets once.

## What to write

1. **Cost and limits.** Estimate the daily token volume and how cost is calculated, without quoting fixed prices. Which changes reduce it, and how would you stop one tenant or a bug from running up the bill?
2. **Reliability.** What happens when the model is slow, rate limited or down? What do you log?
3. **Evaluation.** How would you know the summaries are good before launch and stay good after a prompt or model change?
4. **Security.** What can a customer who writes a ticket make this feature do? Cover the input, the rendered output and the planned tool.
5. **Customer data.** What has to be true before ticket content can be sent to a model provider?

End with the three changes you would require before launch, in order.

## What is assessed

Whether the cost estimate is built from tokens, whether failure handling and evaluation are concrete enough to implement, whether the security section follows untrusted text from the ticket all the way to the browser and to tools, and whether data handling is addressed. There are no automated checks.
