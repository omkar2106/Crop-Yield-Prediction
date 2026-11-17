# Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. A `UserProfile` document at `/users/{userId}` can only be read, created, or updated by the verified authenticated user whose `request.auth.uid == userId`.
2. `UserProfile` documents cannot be listed across users (`allow list: if false`).
3. A `SavedFieldPin` document at `/savedFields/{fieldId}` must carry `ownerId == request.auth.uid` on creation and preserve `ownerId` and `createdAt` immutably on update.
4. `SavedFieldPin` list queries are strictly enforced at the rule layer (`resource.data.ownerId == request.auth.uid`).
5. All string fields enforce explicit `.size()` bounds; all document IDs enforce `^[a-zA-Z0-9_\-]+$`; all writes require `request.auth.token.email_verified == true` and server timestamps (`request.time`).

## 2. Adversarial Payloads ("Dirty Dozen")
1. Unauthenticated read on `/savedFields/field_1` -> `PERMISSION_DENIED`.
2. Cross-user read on `/users/other_uid` -> `PERMISSION_DENIED`.
3. Cross-user list query on `/savedFields` without `where('ownerId', '==', uid)` -> `PERMISSION_DENIED`.
4. Spoofed `ownerId` on create (`/savedFields/f1` with `ownerId: 'victim_uid'`) -> `PERMISSION_DENIED`.
5. Unverified email write (`email_verified: false`) -> `PERMISSION_DENIED`.
6. Ghost field injection (`isAdmin: true`) on create -> `PERMISSION_DENIED` (`hasOnly` check).
7. Ghost field injection on update -> `PERMISSION_DENIED` (`affectedKeys().hasOnly` check).
8. Oversized document ID (>128 chars or invalid characters) -> `PERMISSION_DENIED` (`isValidId`).
9. Oversized string field (`name` > 120 chars) -> `PERMISSION_DENIED`.
10. Client-forged `createdAt` timestamp (`!= request.time`) -> `PERMISSION_DENIED`.
11. Mutating immutable `ownerId` or `createdAt` on update -> `PERMISSION_DENIED`.
12. Deleting another user's `/savedFields/f1` document -> `PERMISSION_DENIED`.
