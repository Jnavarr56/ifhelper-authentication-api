import { Schema, model } from 'mongoose';

const TokenStoreSchema = new Schema(
	{
		user_id: {
			type: Schema.Types.ObjectId,
			ref: 'User',
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
		revoked: {
			type: Boolean,
			default: false
		},
		revoked_at: {
			type: Date,
			default: null
		},
		requester_data: {
			type: Schema.Types.Mixed,
			default: null
		}
	},
	{
		timestamps: {
			createdAt: 'created_at',
			updatedAt: 'updated_at'
		}
	}
);

export default model('TokenStore', TokenStoreSchema, 'TokenStore');
