import { Schema, model } from "mongoose";

const TokenStoreSchema = new Schema(
	{
		user_id: {
			type: Schema.Types.ObjectId,
			ref: "User",
			required: true
		},
		access_token: {
			type: String,
			required: true
		},
		access_token_exp_date: {
			type: Date,
			required: true
		},
		refresh_token: {
			type: String,
			required: true
		},
		refresh_token_exp_date: {
			type: Date,
			required: true
		},
		requester_data: {
			type: Schema.Types.Mixed,
			default: null
		}
	},
	{ timestamps: true }
);

export default model("TokenStore", TokenStoreSchema, "TokenStore");
