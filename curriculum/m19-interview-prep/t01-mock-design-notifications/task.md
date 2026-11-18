A timed mock system design round. **Set a timer for 45 minutes before you read past this paragraph,** and stop when it rings. Write as you would talk on a whiteboard: headings, bullet points, a box diagram in ASCII or Mermaid, short HTTP and SQL. Aim for 800 to 1,400 words. At the end, add one line saying how long you took and what you would have covered with ten more minutes.

## The prompt

> **Pebble** is a project-management SaaS for small agencies. It has 8,000 users today across 600 workspaces and expects about 80,000 users next year. The team is five engineers, running a NestJS monolith on PostgreSQL, deployed as two containers on a PaaS.
>
> Design the **notification system**. When something happens (a comment mentions you, a task is assigned to you, a deadline is tomorrow), the user should hear about it by **in-app notification**, **email**, and on mobile by **push**. Users choose per channel which kinds of notification they want, and can set quiet hours. A burst of comments on one task should not send twenty emails.

## Use this structure

Follow the six steps from lesson 2 and label each section:

1. **Requirements.** Functional and non-functional, and an explicit out-of-scope line. Write down the two or three questions you would ask the interviewer, and the answer you assume for each.
2. **Numbers.** Events per day, notifications per second at peak, emails per day, storage per year. Show the arithmetic and state what it means for the design.
3. **API.** The endpoints the web and mobile clients need: the in-app list, mark as read, unread count, preferences. Methods, paths, main status codes.
4. **Data model.** Tables with keys, the constraints that matter and the indexes the API needs.
5. **The simple design.** A box diagram and the path of one event from "comment created" to an email in someone's inbox. Say which parts run in the request and which in the background.
6. **Failure and scaling.** What happens when the email provider is down, when a worker crashes halfway through a batch, when the same event is processed twice, and what breaks first at 10x.

Finish with a **trade-offs** paragraph: two decisions you made, what each costs, and what you would add next.

## What is assessed

The design is scored like a real round: whether requirements are clarified and scoped, whether the numbers drive the design, whether the API and data model support the features, whether failure handling is concrete, and whether the design stays right-sized for five engineers. Running past 45 minutes is not penalised directly, but a design that stops before failure handling loses those points. There are no automated checks.
