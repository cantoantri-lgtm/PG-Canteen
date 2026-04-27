const { GoogleGenAI, Type } = require('@google/genai');

const ai = new GoogleGenAI({});
ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: 'hello',
}).then(res => console.log('res.text is:', typeof res.text, res.text)).catch(console.error);
