Design file uploads for a small product and defend your choices. Write 600 to 1000 words. Use headings, lists or a table; short code or JSON snippets are welcome but not required.

## The product

**Crewdesk** is HR software for companies of 10 to 300 people. Two features need files:

- **Profile photos.** Every employee can upload one. They appear on every page of the app, in lists of dozens of people at a time. JPEG or PNG, up to 5 MB from a phone.
- **Employment documents.** HR uploads signed contracts, passport scans and payslips as PDFs. Most are under 2 MB, but scanned bundles reach **200 MB**. Only the employee and HR staff of that company may open them.

Facts and requirements:

- 400 customer companies, 40,000 employees. About 2,000 new documents a day, 300 GB of documents in total today, growing by 15 GB a month. Each document is opened about twice in its first month and rarely after that.
- Some of the HR staff upload from slow office connections. An upload that fails at 180 MB should not have to start from zero.
- Customers' lawyers require contracts to be kept for **ten years** after the employee leaves, and that nobody, including Crewdesk engineers, can quietly alter one.
- When a customer cancels, they may ask for all their data to be deleted.
- The team is five engineers on NestJS and Postgres. They use AWS for the database already.

## What to cover

1. **The upload flow** for both features, from the browser's first request to a file that others can see. Where do the bytes go, and what does the API store?
2. **Limits and validation.** How are type and size enforced, at which steps, and what happens to a file that fails a check? How do you handle malware in documents?
3. **Large and interrupted uploads.** How does a 200 MB scan get uploaded on a bad connection, and what cleans up after uploads that never finish?
4. **Access and serving.** How do photos load quickly on a page with 50 faces? How does someone open a contract, and for how long does that link work?
5. **Keys, lifecycle and retention.** Your key layout, lifecycle rules, and how you reconcile "delete everything" with "keep contracts for ten years and prevent changes".
6. **Cost and vendor.** A rough monthly cost at the stated volumes, the biggest cost driver, and whether you would pick S3, Cloudflare R2 or a managed upload service for this team.

## What is assessed

Whether the flow keeps file bytes out of the API and checks every file after upload, whether the large-file and clean-up story holds up, whether access is private by default with a reason for each way of serving, and whether the retention plan, the cost estimate and the vendor choice are concrete. There are no automated checks.
