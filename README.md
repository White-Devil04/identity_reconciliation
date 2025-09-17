# 🔗 Identity Reconciliation Service

Modern, lightweight API that reconciles multiple contact records referring to the same real-world identity. It uses the Disjoint Set Union (DSU, a.k.a. Union–Find) data structure to link transitive duplicates and returns a single primary contact id with a list of secondary ids, along with all unique emails and phone numbers in the group.

Built with Bun, Express, and Mongoose.

---

## ✨ Highlights

- DSU-based identity linking to unify duplicate contacts across transitive matches
- Clear primary/secondary semantics for each group
- Simple REST endpoints: add contacts, identify identity group, list contacts
- Minimal UI in `public/` for manual testing (add contact + identify forms)

---

## 🧠 Why DSU (Union–Find)?

Contact data frequently contains duplicates (e.g., same person with different emails/phone numbers). Duplicates are often transitive: A matches B, B matches C → all three are the same identity.

The Disjoint Set Union (DSU) data structure solves this elegantly:

- Union: Merge two identity sets when a link is discovered (same email or phone)
- Find: Retrieve the canonical representative (root) for any record

We maintain a separate `Parent` collection that represents these sets. Each set has one canonical root (the primary), and every member becomes a secondary except the chosen primary. DSU provides near-constant time amortized union/find, making it ideal for evolving datasets.

---

## 🗂️ Data Model

Two collections are used:

1) Contact
- id (Number) – also stored as Mongo `_id`
- phoneNumber (String | null)
- email (String | null)
- linkedId (Number | null)
- linkPrecedence ("primary" | "secondary")
- createdAt, updatedAt, deletedAt

2) Parent (DSU set)
- id (Number) – mirrors `Contact.id`
- parId (Number) – id of the set's root (primary)
- childIds (Number[]) – all members of the set

Note: The service ensures that unions always converge to a single root. When merging, the numerically smaller root is preferred as the canonical primary.

---

## 🧪 API Overview

Base URL: `http://localhost:3000`

### POST /add-contact
Creates a new contact record, initializes its own DSU set, then unions with any existing sets that share the same email or phone number. If `linkPrecedence` is `secondary`, a `linkedId` must be provided and is united with its root.

Form-encoded body (from the demo UI) or JSON:
```json
{
	"id": 1,
	"phoneNumber": "9876543210",
	"email": "user@example.com",
	"linkedId": 2,          // required when linkPrecedence = "secondary"
	"linkPrecedence": "primary" // or "secondary"
}
```

Response: Redirects to `/` (UI) on success. On validation failure (e.g., missing `linkedId` for secondary), redirects with an error query param.

---

### POST /identify
Given an email and/or phone number, unifies all matching sets and returns a canonical identity summary.

Request JSON:
```json
{
	"email": "user@example.com",
	"phoneNumber": "9876543210"
}
```

Response JSON:
```json
{
	"contact": {
		"primaryContatctId": 1,      // legacy field kept for compatibility
		"primaryContactId": 1,       // corrected field name
		"emails": ["user@example.com", "alt@example.com"],
		"phoneNumbers": ["9876543210", "9999999999"],
		"secondaryContactIds": [2, 3, 4]
	}
}
```

Notes:
- If no existing match is found, a new primary record is created.
- To ensure we don’t miss any values due to schema aliasing, the implementation performs a per-id fetch for all records in the final set to aggregate unique `emails` and `phoneNumbers`.

---

### GET /contacts
Lists all contact documents (for debugging/demo purposes).

---

## ⚙️ Setup

### Prerequisites
- Bun v1.0+
- MongoDB instance (local or remote)

### 1) Install dependencies
### 2) Environment variables
Create a `.env` file in the project root:
```env
MONGO_URI=mongodb://127.0.0.1:27017/identity_reconciliation
PORT=3000
```

### 3) Run the server
```bash
bun run index.js
```

Visit the demo UI at `http://localhost:3000/`

---

## 🧩 How Linking Works (DSU lifecycle)

1) Every new contact starts as its own set: `parId = id`, `childIds = [id]`.
2) If the new contact shares an email or phone number with existing contacts, we union their sets.
3) If `linkPrecedence = secondary`, we also union with the provided `linkedId`'s root.
4) After unifying, we choose the smallest id as the root primary, the rest become secondaries.
5) `/identify` merges any discovered transitive matches on-demand and returns the canonical view (primary id, secondary ids, all unique emails and phones).

Key operation used:
- `unionSets(rootA, rootB)`: merges two sets, updates `parId` for the old set, merges `childIds`, and keeps the minimal id as the new root.

---

## 🚀 Performance & Trade-offs

We explored reducing database round-trips using MongoDB aggregation pipelines (e.g., pre-joining parent/child sets and filtering larger blocks). While this reduced the number of queries in some cases, it introduced non-trivial complexity and edge cases (root lookups, `$size`/$expr nuances, saving aggregation results vs. model documents, etc.).

Current approach favors clarity and correctness:
- Use straightforward queries for root discovery and unions.
- Perform per-id reads when assembling the final response to ensure emails/phones are complete and accurate.

Suggested indexes (optional for scale):
- `Contact.email` (sparse)
- `Contact.phoneNumber` (sparse)
- `Parent.parId`
- `Parent.childIds`

---

## 📁 Project Structure

```
.
├─ index.js                # Express server and routes
├─ models/
│  ├─ contact.js          # Contact schema
│  └─ parent.js           # DSU parent schema (parId, childIds)
├─ public/
│  └─ index.html          # Minimal test UI (add + identify)
├─ package.json
├─ bun.lock
└─ README.md
```

---

## 🧰 Development Notes

- The UI is intentionally minimal but styled for readability.
- `/add-contact` is form-friendly (redirects back to `/`).
- `/identify` is JSON-only and returns both `primaryContatctId` (legacy) and `primaryContactId` (preferred).
- Codebase uses ES Modules (`type: module`) and Bun for fast dev iteration.

---