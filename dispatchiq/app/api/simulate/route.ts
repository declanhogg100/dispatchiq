import { NextResponse } from 'next/server';

// Simulation scenarios with caller personalities
const SCENARIOS = [
  {
    name: 'House Fire',
    personality: 'panicked',
    initialMessage: "Oh my god, there's a fire! My house is on fire! Please help!",
    context: 'House fire, smoke visible, family inside',
  },
  {
    name: 'Car Accident',
    personality: 'shaken',
    initialMessage: "I just witnessed a bad car accident on the highway. There are people injured!",
    context: 'Multi-vehicle collision, injuries reported',
  },
  {
    name: 'Medical Emergency',
    personality: 'urgent',
    initialMessage: "My father just collapsed! He's not responding! I think it's a heart attack!",
    context: 'Elderly male, possible cardiac arrest',
  },
  {
    name: 'Armed Robbery',
    personality: 'whispered',
    initialMessage: "*whispering* There's someone with a gun in the store. Please send help quietly.",
    context: 'Armed robbery in progress, suspect has weapon',
  },
  {
    name: 'Domestic Dispute',
    personality: 'crying',
    initialMessage: "*crying* Please help, my neighbor is screaming and I heard glass breaking!",
    context: 'Possible domestic violence, sounds of struggle',
  },
  {
    name: 'Overdose',
    personality: 'frantic',
    initialMessage: "My friend isn't breathing! I think she took something! Her lips are turning blue!",
    context: 'Possible drug overdose, victim unresponsive',
  },
  {
    name: 'Building Collapse',
    personality: 'panicked',
    initialMessage: "Part of the building just collapsed! There are people trapped under the rubble!",
    context: 'Structural collapse, multiple victims possible',
  },
  {
    name: 'Gas Leak',
    personality: 'worried',
    initialMessage: "I smell gas really strongly in my apartment building. I'm worried it might explode!",
    context: 'Gas leak reported, evacuation may be needed',
  },
  {
    name: 'Missing Child',
    personality: 'frantic',
    initialMessage: "My daughter is missing! She was just in the backyard and now she's gone! She's only 5!",
    context: 'Missing child, last seen recently',
  },
  {
    name: 'Active Shooter',
    personality: 'terrified',
    initialMessage: "*whispering urgently* There's shooting at the mall! I'm hiding in a store! Please hurry!",
    context: 'Active shooter situation, multiple shots fired',
  },
];

export async function POST(req: Request) {
  try {
    const { numCalls = 5 } = await req.json();
    
    // Limit to prevent abuse
    const callCount = Math.min(Math.max(1, numCalls), 10);
    
    // Select random scenarios
    const selectedScenarios = [...SCENARIOS]
      .sort(() => Math.random() - 0.5)
      .slice(0, callCount);
    
    // Notify backend to start simulations
    const response = await fetch('http://localhost:3001/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarios: selectedScenarios }),
    });
    
    if (!response.ok) {
      throw new Error('Backend simulation failed');
    }
    
    const data = await response.json();
    
    return NextResponse.json({ 
      success: true, 
      started: callCount,
      scenarios: selectedScenarios.map(s => s.name),
      ...data,
    });
  } catch (error) {
    console.error('Simulation error:', error);
    return NextResponse.json(
      { error: 'Failed to start simulation' }, 
      { status: 500 }
    );
  }
}

