A different kind of design round: instead of a blank whiteboard, you get a system that already exists and is starting to hurt. Interviewers use this format to see whether you can diagnose before redesigning, and change a running system in safe steps. **Give yourself 45 minutes.** Write 700 to 1,200 words, with a before and after diagram in ASCII or Mermaid.

## The system today

> **Snapfolio** lets photographers upload client galleries. 3,000 photographers, about 40,000 photos uploaded per day, mostly in evening bursts. Four engineers.
>
> ```text
> Browser --(multipart POST /photos, up to 50 MB)--> Node API (2 instances, 1 GB RAM each)
>   API handler:
>     1. buffers the whole file in memory
>     2. resizes it into 3 thumbnails with an image library (in the request)
>     3. uploads the original and thumbnails to S3
>     4. INSERT INTO photos (...) and UPDATE galleries SET photo_count = photo_count + 1
>     5. sends an email "your gallery has new photos" to the photographer's client
>     6. responds 201
> ```
>
> Postgres 18, one instance. The email goes through a transactional email provider's HTTP API.

## The symptoms

The company has grown threefold in six months and expects to triple again this year. Over the last month:

- Uploads time out in the evenings, and some photographers retry, which creates duplicate photos.
- Both API instances have been killed for running out of memory twice this week.
- When the email provider had a 20-minute outage, uploads failed during that time.
- Browsing galleries (unrelated pages) gets slow at the same time as upload peaks.
- Occasionally a photo row exists but its thumbnails are missing in S3.

## What to write

1. **Diagnosis.** For each symptom, the most likely cause in the current design, and what you would measure to confirm it before changing anything.
2. **Target design.** The design you would move to for the next 12 months, with a diagram. Explain the path of one upload from the browser to a finished gallery photo.
3. **Migration plan.** The order in which you would ship the changes, as three to five steps, each safe to deploy alone and each fixing at least one symptom. Say how you keep old clients working during the change.
4. **What you would not do yet,** and the signal that would make you do it.

## What is assessed

Whether each symptom is traced to a concrete cause with a way to confirm it, whether the target design removes the causes rather than adding capacity, whether the steps are incremental and safe, and whether the design stays right-sized for four engineers. There are no automated checks.
