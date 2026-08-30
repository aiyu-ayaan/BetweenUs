---
name: betweenus
description: This skill encapsulates the design principles and best practices for the Between Us project.
---

# Design Engineering Principles
You can find all the details about the project under @development or @CLAUDE.md.
You are strictly advised to use the things mentioned in @development or @CLAUDE.md, and you should not use any other resources or references outside of it.


# Code Scan
For code scanning, you should use the following tools and configurations:
- **Tool**: Codegraph

IMPORTANT: If these tools are not available, you should go to [CodeGraph](https://github.com/colbymchenry/codegraph).
You should follow the instructions in the README file to set up and configure the tool for your project. Make sure to use the recommended settings and configurations for accurate code analysis.

# Commit 
Make commits at all small stages. For commits, follow the rules mentioned in @Claude.md or @development. You should not use any other resources or references outside of it.

# Mandatory Guidelines for AI Assistants & Contributors

1. **TypeScript Strict Mode**: Never commit `any`. Use strict types, discriminated unions, and typed DTOs.
2. **Centralized Authorization**: Never check channel or remote permissions inline inside controllers. Always invoke [`resolveChannelAccess`](file:///D:/VS-Code/AI%20Expermients/Betweenus/packages/database/src/channel-access.ts) or [`resolveRemoteAccess`](file:///D:/VS-Code/AI%20Expermients/Betweenus/packages/database/src/remote-access.ts) from `@betweenus/database`.
3. **Thin Controllers**: Controllers must only handle routing and validation pipes. All domain business logic belongs in injectable NestJS services.
4. **Preserve E2EE**: Never store plaintext messages or send unencrypted message bodies across WebSocket gateways. Never add server endpoints that decrypt message payloads.
5. **No Media Proxies**: Never proxy WebRTC media streams through NestJS, Nginx, or Cloudflare Tunnels. Signalling and ICE configuration belong on WebSockets; media belongs on direct peer connections.
6. **Standardized Error Responses**: All HTTP API errors must conform to `{ error: { code: string, message: string, requestId?: string } }`. Never expose raw stack traces in production.
7. **Redaction & Tracing**: Every request must propagate `x-request-id`. Never log passwords, access tokens, refresh tokens, private keys, or message ciphertext.
8. **Documentation Synchronization**: When modifying features, protocols, or schemas, update the corresponding documents across `development/claude.md`, `development/devdocs/`, `docs/docs/`, and `README.md`.
9. **Commit Guidelines & Attribution**: Follow conventional commit formats (`<type>(<scope>): <short summary>`) detailed in [`development/Commit.md`](Commit.md). Never add AI assistant usernames as author or co-author.
10. **CodeGraph First for Code Scanning**: In repositories with `.codegraph/`, prioritize `codegraph_explore` / `codegraph explore` for semantic code scanning, symbol references, and call graph analysis prior to raw text grep.
11. **Documentation Consistency**: Ensure all documentation is consistent in style, terminology, and structure across all documents and on every change, update 'development/devdocs/' and 'docs/docs/' to reflect the latest architecture, API, and protocol specifications.
12. **NEVER Push Code**: AI assistants must NEVER execute `git push` or push code to remote repositories under any circumstances. All commits must remain strictly local on the user's workspace.