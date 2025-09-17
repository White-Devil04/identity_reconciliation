import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import Contact from "./models/contact.js";
import Parent from "./models/parent.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("Connected to MongoDB");
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));


// Implementing DSU Union function
async function unionSets(rootA, rootB) {
  // Find the Parent documents
  const parentA = await Parent.findOne({ parId: rootA });
  const parentB = await Parent.findOne({ parId: rootB });

  if (!parentA || !parentB) return;

  // Choose the smaller root as the new root
  const newRoot = Math.min(rootA, rootB);
  const oldRoot = newRoot === rootA ? rootB : rootA;
  const newParent = newRoot === rootA ? parentA : parentB;
  const oldParent = newRoot === rootA ? parentB : parentA;

  // Update parId for all in old set
  await Parent.updateMany({ parId: oldRoot }, { parId: newRoot });

  // Merge childIds
  newParent.childIds = [
    ...new Set([...newParent.childIds, ...oldParent.childIds]),
  ];

  // Save the new parent
  await newParent.save();

  // Delete the old parent document
  await Parent.deleteOne({ id: oldParent.id });
}

// POST /add-contact route
app.post("/add-contact", async (req, res) => {
  try {
    const { id, phoneNumber, email, linkedId, linkPrecedence } = req.body;

    // check for the secondary case it must have linkedId
    if (
      linkPrecedence === "secondary" &&
      (!linkedId || linkedId.trim() === "")
    ) {
      return res.redirect("/?error=linkedId required for secondary contacts");
    }

    const newContact = new Contact({
      id: parseInt(id),
      phoneNumber,
      email,
      linkedId: linkedId ? parseInt(linkedId) : undefined,
      linkPrecedence,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await newContact.save();

    // Create Parent entry for the new contact
    const newParent = new Parent({
      id: parseInt(id),
      parId: parseInt(id),
      childIds: [parseInt(id)],
    });
    await newParent.save();

    // Find contacts with same phoneNumber or email
    const matchingContacts = await Contact.find({
      $or: [{ phoneNumber: phoneNumber }, { email: email }],
      id: { $ne: parseInt(id) }, // exclude the new one
    });

    const matchingIds = matchingContacts.map((c) => c.id);

    // Find unique roots for matching contacts
    const roots = new Set();
    for (const mid of matchingIds) {
      const parentDoc = await Parent.findOne({ childIds: mid });
      if (parentDoc) {
        roots.add(parentDoc.parId);
      }
    }

    const newRoot = parseInt(id);

    // If secondary, ensure it unions with the linkedId's root and also check id is existing
    if (linkPrecedence === "secondary" && linkedId) {
      const immediateParent = await Parent.findOne({
        childIds: parseInt(linkedId),
      });
      if (immediateParent) {
        const linkedRoot = immediateParent.parId;
        if (Number.isFinite(linkedRoot) && linkedRoot !== newRoot) {
          await unionSets(linkedRoot, newRoot);
        }
      }
    }

    // Union with each root
    for (const root of roots) {
      if (root !== newRoot) {
        await unionSets(newRoot, root);
      }
    }

    res.redirect("/index.html");
  } catch (error) {
    res.redirect("/?error=Error fetching contacts");
  }
});

// POST /identify route
app.post("/identify", async (req, res) => {
  try {
    const { email, phoneNumber } = req.body || {};

    // Validate: at least one identifier must be provided
    const orFilters = [];
    if (email) orFilters.push({ email });
    if (phoneNumber) orFilters.push({ phoneNumber });
    if (orFilters.length === 0) {
      return res.status(400).json({ error: "Provide email or phoneNumber" });
    }

    // Find contacts matching provided identifiers
    const matchingContacts = await Contact.find({ $or: orFilters });

    // If no matches: create a new standalone node and return summary
    if (matchingContacts.length === 0) {
      // Generate a new numeric id
      const maxDoc = await Contact.findOne({}, { _id: 1 }).sort({ _id: -1 });
      const newId = maxDoc ? Number(maxDoc._id) + 1 : 1;

      const created = new Contact({
        id: newId,
        email: email ?? undefined,
        phoneNumber: phoneNumber ?? undefined,
        linkPrecedence: "primary",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await created.save();

      const parent = new Parent({ id: newId, parId: newId, childIds: [newId] });
      await parent.save();

      return res.json({
        contact: {
          // return the data field and corrected field name
          primaryContactId: newId,
          emails: email ? [email] : [],
          phoneNumbers: phoneNumber ? [phoneNumber] : [],
          secondaryContactIds: [],
        },
      });
    }

    // There are matches: compute all roots for matched contacts
    const matchedIds = matchingContacts.map((c) => c.id);
    const parentRoots = await Parent.find({
      childIds: { $in: matchedIds },
    }).select("parId");
    const roots = new Set(parentRoots.map((p) => p.parId));

    // Union all roots into one set (choose minimal as base)
    const rootsArr = Array.from(roots).filter((r) => Number.isFinite(r));
    let baseRoot = Math.min(...rootsArr);

    for (const r of rootsArr) {
      if (r !== baseRoot) {
        await unionSets(baseRoot, r);
        baseRoot = Math.min(baseRoot, r); // remains baseRoot, but keep logic explicit
      }
    }

    // Fetch the final parent block (any doc with parId = baseRoot will do)
    const finalParent = await Parent.findOne({ parId: baseRoot });
    const idList = [baseRoot, ...(finalParent?.childIds || [])];

    // Per-id fetch: get each contact by its numeric _id to avoid alias issues
    const emailSet = new Set();
    const phoneSet = new Set();
    const seenIds = new Set();
    for (const cid of idList) {
      if (seenIds.has(cid)) continue;
      seenIds.add(cid);
      try {
        const doc = await Contact.findById(cid);
        if (!doc) continue;
        if (doc.email) emailSet.add(doc.email);
        if (doc.phoneNumber) phoneSet.add(doc.phoneNumber);
      } catch (_) {}
    }

    // Secondary ids: all ids excluding baseRoot (preserve original order where possible)
    const secondaryIds = idList.filter((cid) => cid !== baseRoot);

    return res.json({
      contact: {
        primaryContatctId: baseRoot,
        primaryContactId: baseRoot,
        emails: Array.from(emailSet),
        phoneNumbers: Array.from(phoneSet),
        secondaryContactIds: secondaryIds,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error identifying contact" });
  }
});

// GET /contacts route
app.get("/contacts", async (req, res) => {
  try {
    const contacts = await Contact.find({});
    res.json(contacts);
  } catch (error) {
    res.status(500).json({ error: "Error fetching contacts" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
