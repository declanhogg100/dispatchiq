import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { callSid, actionId, decision } = await req.json();
    
    if (!callSid || !actionId || !decision) {
      return NextResponse.json(
        { error: 'Missing required fields' }, 
        { status: 400 }
      );
    }
    
    // Notify backend of action decision
    const response = await fetch('http://localhost:3001/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callSid, actionId, decision }),
    });
    
    if (!response.ok) {
      throw new Error('Backend action update failed');
    }
    
    const data = await response.json();
    
    return NextResponse.json({ 
      success: true, 
      callSid,
      actionId,
      decision,
      ...data,
    });
  } catch (error) {
    console.error('Action approval error:', error);
    return NextResponse.json(
      { error: 'Failed to process action' }, 
      { status: 500 }
    );
  }
}

