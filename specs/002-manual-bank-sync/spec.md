# Feature Specification: Manual SimpleFIN Bank Sync

**Feature Branch**: `002-manual-bank-sync`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "Let's work on real bank sync. I think we need to make the connection, but put the actual sync task on a button that is manually pressed. That way we don't constently sync as we develop. make a plan and spec for this."

**Credential design update**: Protect the Access URL with a passkey and replicate only its encrypted form so the connecting user can unlock it on their own compatible devices. Sharing the credential with other organization members remains out of scope.

## User Scenarios & Testing

### User Story 1 - Connect a SimpleFIN account (P1)

As a user, I can connect SimpleFIN for the active organization and protect its credential with a passkey so I can manually sync from my own compatible devices without exposing the credential to other organization members.

**Why this priority**: A protected, recoverable connection is the prerequisite for using a bank-data provider across devices.

**Independent Test**: A user verifies passkey encryption support before claiming a valid setup token, connects on one device, and unlocks the replicated encrypted credential on a second compatible device using the same synced passkey. Another organization member cannot decrypt it through membership alone.

**Acceptance Scenarios**:

1. **Given** a user has entered a valid setup token, **When** they explicitly connect, **Then** the app first verifies that their chosen passkey can encrypt and subsequently decrypt a harmless sample, claims the token only after that succeeds, discards the token, persists only an encrypted Access URL, and reports the connection as locked when setup finishes. Connecting does not fetch transactions.
2. **Given** a claim fails, **When** the user tries to connect, **Then** the setup token is not retained, the app reports that the token may have been claimed or compromised, and no connection is marked active.
3. **Given** the encrypted connection has replicated to another device belonging to the same signed-in user, **When** they explicitly unlock with the same synced passkey on a compatible browser and password manager, **Then** the credential is decrypted locally without claiming another setup token. Opening the app or receiving the encrypted record does not prompt for the passkey or fetch provider data.
4. **Given** another organization member can view shared connection metadata, **When** they access the organization, **Then** membership alone does not provide the credential or the key to decrypt it.
5. **Given** passkey encryption is unsupported, verification is cancelled, or a round trip cannot reproduce the encryption key, **When** setup is attempted, **Then** the app reports the problem before claiming the setup token and does not fall back to plaintext storage.
6. **Given** a claim succeeds but encrypted persistence fails, **When** setup ends, **Then** the app does not report a usable saved connection and explains that the consumed token cannot be reused and the provider connection may need to be revoked and set up again.

---

### User Story 2 - Link provider accounts to local accounts (P1)

As a user with permission to manage the active organization's accounts, I can map each available provider account to the matching local account so imported transactions are assigned to the correct ledger.

**Why this priority**: Imports need a deliberate destination to preserve account-level financial organization and authorization.

**Independent Test**: An owner/admin can see provider accounts, map one to a local account, and verify that the mapping remains associated with the organization.

**Acceptance Scenarios**:

1. **Given** an active connection with provider accounts, **When** an owner/admin chooses a local account for a provider account, **Then** the mapping is saved and subsequent manual syncs target that local account.
2. **Given** an account is not mapped, **When** the owner/admin views account mappings, **Then** it is clearly identified as not eligible for transaction import until mapped.
3. **Given** a mapping refers to an archived or unavailable local account, **When** a sync is requested, **Then** imported transactions are not silently assigned to another account and the owner/admin receives an actionable mapping error.

---

### User Story 3 - Import transactions only on explicit request (P1)

As a user with permission to write transactions to the active organization, I can press Sync now on a compatible device, unlock my encrypted connection with its passkey, and fetch and import available transactions when I choose, without the application syncing automatically.

**Why this priority**: Manual initiation is the defining behavior: it gives users control over provider requests and prevents repeated calls during development or ordinary app use.

**Independent Test**: On a device with a replicated encrypted connection, open and reload the app without pressing Sync now and verify no provider transaction fetch occurs; press Sync now, complete passkey verification, and verify one sync attempt and its result. Cancelling verification causes zero provider requests.

**Acceptance Scenarios**:

1. **Given** an active encrypted connection owned by the user and no sync currently running on this device, **When** the authorized user presses Sync now and completes passkey verification, **Then** one sync attempt begins and its progress/result is shown. Cancelling or failing verification makes no provider request.
2. **Given** an active encrypted connection, **When** the application starts, reloads, becomes online, or receives ordinary data changes without an explicit Sync now action, **Then** it does not fetch provider transactions.
3. **Given** a sync is in progress, **When** the user presses Sync now again, **Then** a second concurrent attempt is not started and the in-progress state is communicated.
4. **Given** the provider request fails or the device loses connectivity, **When** the sync attempt ends, **Then** the user sees a failure status, previously imported transactions remain intact, and no automatic retry occurs.
5. **Given** a sync attempt completes, **When** the user views connection status, **Then** the most recent attempt time and outcome are available.
6. **Given** a sync succeeds, fails, or is cancelled, **When** the attempt ends, **Then** the credential is locked again and its decrypted value and usable key are not persisted or reused for the next attempt.

---

### User Story 4 - Review imported transactions without duplicates (P1)

As a user, I can use repeated manual syncs without creating duplicate transactions for the same provider transaction.

**Why this priority**: Reliable repeat sync is essential when the only refresh mechanism is user-initiated.

**Independent Test**: Import a provider transaction, repeat the manual sync with the same provider transaction, and verify that only one corresponding transaction exists.

**Acceptance Scenarios**:

1. **Given** a provider transaction has already been imported, **When** a later manual sync returns the same provider transaction, **Then** no duplicate local transaction is created.
2. **Given** a provider returns a new supported transaction for a mapped account, **When** sync completes, **Then** the transaction appears with the correct local account, amount, currency, date, and provider provenance.
3. **Given** a provider transaction cannot be safely normalized or associated, **When** a sync processes it, **Then** it is not imported with guessed or corrupted financial values and the sync result identifies that some records could not be imported.

## Edge Cases

- A second connection is submitted by the same user for an organization where they already have an active connection.
- The claim succeeds remotely but the application cannot safely persist the resulting credential.
- The provider returns no accounts, no transactions, or transactions outside the supported currency/amount/date representation.
- A sync is requested while another request is in progress, after a connection is revoked, or with no mapped accounts.
- A sync partially succeeds before a provider/network error occurs.
- A provider returns previously seen transactions in a different order or with updated descriptive details.
- An account mapping is changed after transactions have previously been imported.
- A transaction's provider identifier is missing or repeated across accounts.
- User loses network connectivity before or during a manual sync.
- A browser supports passkey sign-in but the selected password manager does not return usable encryption key material.
- A passkey works in one browser but is unavailable or cannot reproduce the encryption key on another physical device.
- The encrypted credential has not replicated yet, or the user is signed into a different application identity on the second device.
- The passkey is deleted, replaced with a newly created passkey, or unavailable after password-manager account loss.
- Ciphertext or encryption metadata is modified, belongs to another user/organization, or is from an unsupported format version.
- A user disconnects while another device is offline or a provider request is already in flight; removing app data cannot invalidate a previously decrypted provider credential.
- The app hostname changes and the original passkey is no longer usable there.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST support user-initiated SimpleFIN setup using a setup token, with the resulting Access URL encrypted for the connecting user before persistent storage or replication.
- **FR-002**: The setup token MUST be used only for the one-time claim operation and MUST NOT be persisted, logged, or replicated. If a stateless CORS relay is required, it MUST process the token only for the request and MUST NOT retain or log it.
- **FR-003**: The claimed Access URL MUST be protected by passkey-based encryption. Only ciphertext and the non-secret metadata needed to unlock it MAY be persisted or replicated through Jazz. Plaintext credentials and usable decryption keys MUST NOT be persisted, logged, placed in navigation URLs, or shown in ordinary UI. Plaintext MAY exist transiently on the client for an explicit provider operation and in a stateless relay only when required.
- **FR-004**: Connection actions MUST be user initiated and scoped to the active application identity and organization. Encrypted credentials MUST be owned by the connecting user and bound to that user, organization, and connection. Other organization members MUST NOT gain decryption access through organization membership. Sharing with other members is out of scope.
- **FR-005**: The system MUST let an authorized organization user view provider accounts and map each importable provider account to one local organization account.
- **FR-006**: The system MUST provide a clearly labeled Sync now action for an authorized connection owner on a compatible device, distinguishing a saved locked connection from one unavailable on this device.
- **FR-007**: Provider transaction fetching MUST occur only as a direct result of an explicit Sync now action. App startup, reload, reconnecting to the network, background timers, development reloads, and ordinary data changes MUST NOT initiate or retry a provider transaction fetch.
- **FR-008**: The system MUST prevent concurrent sync attempts for the same user/organization connection within a device, including multiple tabs, and communicate the current attempt state. Cross-device imports MUST retain the duplicate-prevention guarantees of FR-010.
- **FR-009**: The system MUST import supported provider transactions only for explicitly mapped, active local accounts, preserving transaction amount, currency, kind, business date, provider source, and provider transaction identifier.
- **FR-010**: The system MUST use provider identifiers with account/connection context to make repeated manual syncs idempotent and prevent duplicate transactions.
- **FR-011**: A failed sync MUST preserve transactions already stored, communicate an actionable outcome, and MUST NOT trigger an automatic retry.
- **FR-012**: The system MUST report the most recent sync attempt time and outcome, including partial-import outcomes when applicable.
- **FR-013**: A connection owner MUST be able to disconnect or replace their connection for an organization. Once disconnect is observed on a device, it MUST discard decrypted credential state and prevent new fetches until reconnected. The app MUST distinguish disconnecting from provider-side revocation and explain that offline devices or previously copied credentials require provider revocation to invalidate access.
- **FR-014**: All user-visible labels, status messages, and errors MUST be localized through the application's supported localization system.
- **FR-015**: Sync behavior MUST not block ordinary local finance workflows; a user must be able to continue reviewing existing data while an online sync is pending or has failed.

- **FR-016**: Before claiming a setup token, the system MUST verify that the selected passkey can protect and subsequently unlock a harmless sample. Passkey creation or sign-in success alone MUST NOT be treated as encryption compatibility. Unsupported configurations MUST receive an actionable error without a silent security downgrade.
- **FR-017**: The same signed-in user MUST be able to unlock a replicated encrypted connection on their own compatible devices using the same synced passkey and required encryption metadata, without re-entering the SimpleFIN setup token. Replication MUST NOT include the passkey or plaintext decryption keys.
- **FR-018**: Each Sync now action MUST require passkey user verification before the credential is decrypted. A cancelled or failed unlock MUST make no provider request. Decrypted credentials and usable key references MUST be released after completion, failure, cancellation, identity/organization change, or leaving the connection workflow; they MUST NOT be persisted for later attempts. Other credential-using actions, such as account discovery, MUST also be explicit and passkey-unlocked, and MUST NOT fetch transactions.
- **FR-019**: If the passkey is lost or can no longer unlock the saved credential, the system MUST preserve imported finance data and offer reconnection with a new setup token and passkey. Application sign-in, password-manager account recovery, or creating a different passkey MUST NOT be presented as guaranteed recovery of the old encrypted credential.
- **FR-020**: The system MUST reject modified, incorrectly scoped, or unsupported encrypted credential records without using them for provider requests, exposing plaintext, or overwriting an existing working connection.
- **FR-021**: Connection status MUST distinguish locked, waiting for encrypted credential replication, incompatible/unavailable passkey, disconnected, and provider failure states. A replicated last-sync result MUST NOT imply this device can unlock the credential.

### Key Entities

- **Provider Connection**: An organization-associated provider connection owned by its connecting user, with shared non-secret status and a protected credential.
- **Encrypted Provider Credential**: Replicated ciphertext and versioned non-secret unlock metadata bound to the connection owner, organization, and connection. It contains no plaintext Access URL or usable decryption key.
- **Passkey Unlock**: A local, user-verified operation that makes the credential available for one explicit provider operation. The password manager manages passkey synchronization; the application replicates encrypted credential data separately.
- **Provider Account Mapping**: The relationship between a SimpleFIN account and an active local financial account.
- **Sync Attempt**: One user-initiated provider fetch with start time, completion outcome, and imported/omitted record counts.
- **Imported Transaction**: A local transaction with provider provenance and a stable external identifier used to prevent duplicate imports.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of provider transaction fetches are attributable to an explicit Sync now action by a user authorized to write transactions to the organization; zero fetches are initiated by app startup, reload, network reconnection, timers, or development reloads.
- **SC-002**: A user can complete a successful provider connection on a supported device and see its local status in under 3 minutes, excluding time spent completing provider-side setup.
- **SC-003**: 100% of repeat sync results containing an already-imported provider transaction create zero additional duplicates.
- **SC-004**: Inspection of persisted application records and replicated payloads finds zero plaintext Access URLs or usable decryption keys. An organization member without the owner's passkey cannot decrypt the credential through organization access alone.
- **SC-005**: After a failed or interrupted sync, previously saved transactions remain available and no provider request is automatically retried.
- **SC-006**: In a successful sync, supported transactions from mapped accounts are visible with matching amount, currency, account, business date, and provider identity.

- **SC-007**: On each declared supported configuration, the same user can connect on device A and unlock the replicated credential on a second physical device using the same synced passkey, without a second provider setup token. Compatibility results record browser, OS, password-manager versions, and whether a locally synced passkey or phone/QR flow was used; these paths are reported separately.
- **SC-008**: Unsupported encryption, cancelled unlocks, lost passkeys, and modified credential records cause zero unauthorized provider requests and preserve all existing finance data.

## Assumptions

- SimpleFIN remains the provider; imported transactions use the existing USD-focused workflow, with unsupported records reported and omitted rather than approximated.
- Passkey-based encryption uses the WebAuthn PRF capability. A syncing password manager such as 1Password can supply the same passkey across a user's devices, but actual encryption support must be verified rather than inferred from passkey sign-in support.
- One active connection per connecting user and organization is supported initially. Other members can use imported finance data according to organization permissions but do not receive the ability to decrypt or operate that user's connection. Passkey possession does not replace application identity or organization authorization checks.
- The app replicates encrypted credentials through Jazz; the password manager separately manages the passkey. Both the correct application identity and the original compatible passkey are needed on a second device. Manual experiment-file transfer is not the production synchronization flow.
- Initial recovery is reconnection with a new setup token/passkey; backup passkey enrollment, recovery keys, credential sharing with other members, and general group key management are deferred. Losing unlock access does not delete imported transactions or mappings.
- Supported deployments use a stable HTTPS application address. Hostname changes, password-manager migration, passkey export/import, and phone/QR flows are not assumed to preserve unlock access without verification.
- The harmless-sample experiment has demonstrated successful recovery in the reported browser trial. Cross-physical-device synchronization, production Jazz ciphertext replication, and the final support matrix remain to be validated before declaring this feature supported across devices.
- All transaction fetches remain explicit: no automatic first sync, startup/network-triggered sync, background refresh, timers, or automatic retries. A manual retry repeats passkey verification and preserves duplicate prevention.
- Existing accounts, memberships, Jazz permissions, and organization-scoped mappings, transactions, and sync results are reused. The existing replicated `simplefinConnections.accessUrl` field MUST NOT hold a plaintext credential.
- A relay may transiently forward explicit provider requests when CORS requires it; it must not retain or log credentials or responses. Passkey encryption protects stored/replicated credentials, not against malicious application code during an unlocked operation or a compromised relay handling a request.
- Disconnect deletes the app's usable connection state as replicas observe it. Invalidating an Access URL that was previously decrypted requires provider-side revocation; no immediate revocation guarantee is made for an offline device.
