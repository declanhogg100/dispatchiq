import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { enabled } = await req.json();
    
    // Notify backend to toggle AI mode
    const response = await fetch('http://localhost:3001/api/ai-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    
    if (!response.ok) {
      throw new Error('Backend AI mode toggle failed');
    }
    
    const data = await response.json();
    
    return NextResponse.json({ 
      success: true, 
      aiModeEnabled: enabled,
      ...data,
    });
  } catch (error) {
    console.error('AI mode toggle error:', error);
    return NextResponse.json(
      { error: 'Failed to toggle AI mode' }, 
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const response = await fetch('http://localhost:3001/api/ai-mode');
    if (!response.ok) {
      throw new Error('Failed to get AI mode status');
    }
    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ aiModeEnabled: false });
  }
}

