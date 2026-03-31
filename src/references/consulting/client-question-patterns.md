# Client Question Patterns

## Purpose

Good questions for the client team demonstrate that we investigated the repo thoroughly and identified areas where code alone doesn't tell the full story. These questions show competence, not ignorance.

## Question categories

### Architecture decisions
Questions about why something was built a certain way. These show we noticed the pattern and want to understand the reasoning.

Examples:
- "The middleware handles site resolution via X pattern. Was this a deliberate choice over Y, or is there a constraint we should know about?"
- "We see the component factory is auto-generated. Are there components that are manually registered outside this process?"

### Operational context
Questions about how the project runs in production. Code doesn't always reveal operational reality.

Examples:
- "What's the deployment pipeline? We see indicators of Vercel/Netlify but want to confirm."
- "How is content publishing handled? We see revalidation endpoints but want to understand the workflow."
- "What's the typical content update frequency? This affects our caching recommendations."

### Known issues / tech debt
Questions that give the client permission to share problems they know about but haven't fixed.

Examples:
- "We noticed X pattern that's unusual. Is there a known issue or constraint driving this?"
- "The editing integration uses an older pattern. Is there a planned upgrade or constraint preventing it?"

### Team and process
Questions about how the team works, which affects our recommendations.

Examples:
- "How many developers work on this project regularly?"
- "Do content authors use the editing experience, or do they work in the CMS directly?"
- "Is there a staging environment where we can test changes before production?"

## What makes a question good

- It references something specific we found in the repo
- It can't be answered by reading the code (otherwise we should just read the code)
- It helps us understand context that shapes our recommendations
- It makes the client feel heard ("they actually looked at our code")

## What makes a question bad

- It's generic ("what framework do you use?" when we already know)
- It reveals we didn't read the repo ("do you have tests?" when there's a test directory)
- It's too technical for the audience (adjust based on who we're presenting to)
- It's leading ("don't you think you should upgrade?" — that's a recommendation, not a question)
