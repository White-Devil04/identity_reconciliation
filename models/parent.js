import mongoose from "mongoose";

const parentSchema = new mongoose.Schema({
  _id: { type: Number, alias: 'id' },
  parId: { type: Number, required: true },
  childIds: [{ type: Number }] 


  // _id: Number, // the root id
  // childIds: [Number] // all members, including root
});

const Parent = mongoose.model('Parent', parentSchema);

export default Parent;