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
	try {
		const models = getModels();
		res.json(models);
	} catch (error) {
		console.error('Get model list error:', error);
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
	try {
    const request: MessagesRequest = req.body;

		// Basic validation
		if (!request.model || !request.messages || !request.max_tokens) {
			return res.status(400).json({
				error: {
					message: "Missing required fields: model, messages, or max_tokens",
					type: "invalid_request_error",
				},
				type: "error"
			})
		}

		if(request.stream){
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

		//Non-streaming response
		const response = createMessage(request);

		//Check if it's an error response
		if (response.type === 'error') {
			return res.status(400).json(response);
		}

		res.json(response);

	
	}catch (error) {
		console.error('Messages request error:', error);
		res.status(500).json({
			error:{
				message: 'Internal server error',
				type: 'api_error',
				code: 'internal_error'
			}
		})
	}
}
