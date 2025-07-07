// Anthropic API compatible types definition

export interface Model {
	id: string;
	type: string;
	created_at: string;
	display_name: string;
}

export interface ModelsResponse {
	data: Model[];
	first_id: string | null;
	has_more: boolean;
	last_id: string | null;
}

export interface Message {
	role: 'assistant' | 'user';
	content: any; //temp
}

export interface MCPServer{
	name:	string
  type: 'url';
	url: string;
	authorization?: string;
	configuration?: {
		allowed_tools?: string[];
		enabled?: string[];
	};
}

export interface SystemPrompt{
	text: string;
	type: 'text';
	cache_control?: {
		type: 'ephemeral';
		ttl: '1h' | '5m';
	}
	citations?:{
		cited_text: string;
		document_index: number;
		document_title: string | null;
		end_char_index: number;
		start_char_index: number;
		type: 'char_location';
	}
}

export interface Thinking{
  budget_tokens: number;
	type: 'enabled';
}

export interface MessagesRequest {
	model: string;
	messages: Message[];
	max_tokens: number;
	container?: string | null;
	mcp_server?: MCPServer;
	metadata?: {
		user_id?: string;
	};
	service_tier?: 'standard_only' | 'auto';
	stop_sequence?: string[];
	stream?: boolean;
	system?: SystemPrompt;
	temperature?: number;
	thinking?: Thinking;
	tool_choice?: any;
	tools?: any;
	top_k?: number;
	top_p?: number;
}

export interface Usage{
	cache_creation: {
		ephemeral_1h_input_tokens: number | null;
		ephemeral_5m_input_tokens: number | null;
	}
	cache_creation_input_tokens: number | null;
	cache_read_input_tokens: number | null;
	input_tokens: number;
	output_tokens: number;
	server_tool_use: {
		web_search_requests: number;
	} | null;
	service_tier: 'standard' | 'priority' | 'batch' | null;
}

export interface Container{
	expires_at: string;
	id: string;
}

export interface MessagesResponse{
	id: string;
	type: 'message';
	role: 'assistant';
	content: Array<{
		type: string;
		text: string;
	}>;
	model: string;
	stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' |
	 'tool_use' | 'pause_turn' | 'refusal' | null;
	stop_sequence: string | null;
	usage: Usage;
	container: Container | null;
}

export interface ErrorResponse{
	error: {
		message: string,
		type: string,
	},
	type: "error"
}

export interface MessageStartEvent{
	type: 'message_start';
	message: MessagesResponse;
}

export interface MessageDeltaEvent{
	type: 'message_delta';
	delta: {
		stop_reason?: 'end_turn' | 'max_tokens' | 'stop_sequence' |
		'tool_use' | 'pause_turn' | 'refusal' | null;
		stop_sequence?: string | null;
	}
	usage: {
		output_tokens: number;
	}
}

export interface MessageStopEvent{
	type: 'message_stop';
}

export interface ContentBlockStartEvent{
	type: 'content_block_start';
	index: number;
	content_block: {
		type: 'text';
		text: string;
	}
}

export interface ContentBlockDeltaEvent{
	type: 'content_block_delta';
	index: number;
	delta: {
		type: 'text_delta';
		text: string;
	}
}

export interface ContentBlockStopEvent { type: 'content_block_stop'; index: number; }  
export interface PingEvent { type: 'ping'; }  
export interface ErrorEvent { type: 'error'; error: string; }  


export type StreamingEvent = 
	'message_start' | 
	'content_block_start' |
	'content_block_delta' | 
	'content_block_stop' |
	'message_delta' |
	'message_stop' |
	'ping' |
	'error';
	



