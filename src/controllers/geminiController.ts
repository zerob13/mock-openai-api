
import { Request, Response } from 'express';

export const handleGeminiRequest = (req: Request, res: Response) => {
  const { contents } = req.body;

  if (!contents) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const responseText = 'This is a mock response from the Gemini API.';

  const response = {
    candidates: [
      {
        content: {
          parts: [
            {
              text: responseText,
            },
          ],
          role: 'model',
        },
        finishReason: 'STOP',
        index: 0,
        safetyRatings: [
          {
            category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
            probability: 'NEGLIGIBLE',
          },
          {
            category: 'HARM_CATEGORY_HATE_SPEECH',
            probability: 'NEGLIGIBLE',
          },
          {
            category: 'HARM_CATEGORY_HARASSMENT',
            probability: 'NEGLIGIBLE',
          },
          {
            category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
            probability: 'NEGLIGIBLE',
          },
        ],
      },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    },
  };

  res.json(response);
};
