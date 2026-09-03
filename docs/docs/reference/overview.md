---
sidebar_position: 1
title: Interactive Code Explorer
description: Live interactive code reference and source explorer for BetweenUs — inspect full code files with verbatim documentation comments and symbols.
displayed_sidebar: null
---

import CodeReferenceExplorer from '@site/src/components/CodeReferenceExplorer';

# Code & API Reference

Welcome to the **BetweenUs Code Reference**. Below is the live source-code explorer displaying the **actual source files** directly from the codebase with every JSDoc, KDoc, and Prisma documentation comment intact.

Use the tabs to switch between shared TypeScript contracts, the PostgreSQL Prisma schema, WebSocket gateways, and Android E2EE cryptography. You can search across all symbols, filter to documentation comments only, or view and copy the full source.

---

<CodeReferenceExplorer />

---

## Direct Code Reference Modules

For focused deep-dives into each subsystem, explore the documentation guides below:

- [**Shared Types & DTO Contracts**](/reference/shared-types): Complete TypeScript interfaces, DTOs, and protocol contracts from `packages/shared-types`.
- [**REST API Endpoints**](/reference/api-endpoints): Full HTTP REST specifications, request/response DTOs, and headers for all microservices.
- [**WebSocket Gateway Protocol**](/reference/websocket-protocol): Event opcodes, frame formats, and switchboard signaling for `/ws/chat` and `/ws/call`.
- [**Database Schema & Prisma Models**](/reference/database-schema): PostgreSQL models, relations, field constraints, and comments from `packages/database`.
- [**Android Core Architecture & Crypto**](/reference/android-core): Native Kotlin data classes, Room entities, and Android KeyStore cryptographic primitives.
