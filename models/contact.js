import mongoose from 'mongoose';

const contactSchema = new mongoose.Schema({
  _id: { type: Number, alias: 'id' },
  phoneNumber: String,
  email: String,
  linkedId: Number,
  linkPrecedence: { type: String, enum: ['secondary', 'primary'], required: true },
  createdAt: { type: Date, required: true },
  updatedAt: { type: Date, required: true },
  deletedAt: Date
});

const Contact = mongoose.model('Contact', contactSchema);

export default Contact;