import { Request, Response } from 'express';
import {
	getModels,
	createMessage,
	createMessageStream
} from '../services/anthropicService';  
import { MessagesRequest } from '../types/anthropic';

/**
 * Get model list
 * 
 */
export function handleGetModels(req: Request, res: Response) {
	console.log('🔍 [Anthropic] GET /anthropic/v1/models - Request received');
	console.log('🔍 [Anthropic] Headers:', JSON.stringify(req.headers, null, 2));
	console.log('🔍 [Anthropic] Query params:', JSON.stringify(req.query, null, 2));
	
	try {
		const models = getModels();
		console.log('✅ [Anthropic] Models retrieved successfully:', models);
		res.json(models);
	} catch (error) {
		console.error('❌ [Anthropic] Get model list error:', error);
		res.status(500).json({
			error: {
				message: 'Internal server error',
			}
		})
	}
}

/**
 * Handle Messages request
 */
export function handleMessage(req: Request, res: Response){
	console.log('🔍 [Anthropic] POST /anthropic/v1/messages - Request received');
	console.log('🔍 [Anthropic] Headers:', JSON.stringify(req.headers, null, 2));
	console.log('🔍 [Anthropic] Body:', JSON.stringify(req.body, null, 2));
	
	try {
    const request: MessagesRequest = req.body;

		// Basic validation
		if (!request.model || !request.messages || !request.max_tokens) {
			console.log('❌ [Anthropic] Validation failed - missing required fields');
			return res.status(400).json({
				error: {
					message: "Missing required fields: model, messages, or max_tokens",
					type: "invalid_request_error",
				},
				type: "error"
			})
		}

		if(request.stream){
			console.log('📡 [Anthropic] Streaming response requested');
			res.setHeader('Content-Type', 'text/event-stream');
			res.setHeader('Cache-Control', 'no-cache');
			res.setHeader('Connection', 'keep-alive');
			res.setHeader('Access-Control-Allow-Origin', '*');
			res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

			const stream = createMessageStream(request);
			for(const chunk of stream){
				res.write(chunk);
			}
			res.end();
			return;
		}

		console.log('📄 [Anthropic] Non-streaming response requested');
		//Non-streaming response
		const response = createMessage(request);

		//Check if it's an error response
		if (response.type === 'error') {
			console.log('❌ [Anthropic] Error response:', response);
			return res.status(400).json(response);
		}

		console.log('✅ [Anthropic] Success response generated');
		res.json(response);

	
	}catch (error) {
		console.error('❌ [Anthropic] Messages request error:', error);
		res.status(500).json({
			error:{
				message: 'Internal server error',
				type: 'api_error',
				code: 'internal_error'
			}
		})
	}
}
