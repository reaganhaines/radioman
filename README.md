# radioman
## Automated radio sidekick
OpenAI GPT 4o realtime model instructed to be a radio sidekick

Features a simplified frontend documenting the conversation history

### Local use
- Clone repo
- Download node and typescript
- Run `npm install --production` or `npm install`
- Run `tsc`
- Create a .env file in the project root and add your OpenAI API key: `OPENAI_API_KEY=...`
- Run `node dist/server.js`
- Go to http://localhost:3000 in your browser
