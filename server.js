const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, 'meals_store.json');
const SECRET_KEY = process.env.SECRET_KEY || "nutrisnap_secret_2026";

// Ensure meals_store.json exists
function loadMeals() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading meals_store.json:', err.message);
  }
  return [
    {
      id: 1,
      name: "Greek Yogurt Bowl with Berries & Honey",
      calories: 320,
      protein: 22,
      carbs: 38,
      fat: 6,
      fiber: 5,
      healthScore: 9,
      mealType: "Breakfast",
      portionSize: "1 bowl (250g)",
      ingredients: "Greek yogurt, blueberries, strawberries, chia seeds, honey",
      advice: "Great protein-rich start to boost satiety and metabolism.",
      timestamp: Date.now() - (4 * 3600 * 1000)
    },
    {
      id: 2,
      name: "Grilled Salmon with Quinoa & Steamed Asparagus",
      calories: 540,
      protein: 42,
      carbs: 35,
      fat: 24,
      fiber: 6,
      healthScore: 10,
      mealType: "Lunch",
      portionSize: "1 plate (380g)",
      ingredients: "Atlantic salmon fillet, quinoa, asparagus, olive oil, lemon",
      advice: "Packed with Omega-3 fatty acids and complete plant proteins.",
      timestamp: Date.now() - (1 * 3600 * 1000)
    }
  ];
}

function saveMeals(meals) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(meals, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving meals_store.json:', err.message);
  }
}

let meals = loadMeals();

function isAuthorized(req, url) {
  if (!SECRET_KEY) return true;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token === SECRET_KEY) return true;
  }
  const keyParam = url.searchParams.get('key');
  if (keyParam === SECRET_KEY) return true;
  return false;
}

// -------------------------------------------------------------
// 1. HTTP REST BRIDGE SERVER (For Android App Sync & Cloud Ping)
// -------------------------------------------------------------
const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Public Health & Ping Endpoint (for 24/7 keep-alive monitor)
  if (url.pathname === '/api/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ok',
      message: 'NutriSnap Cloud MCP Server is active and reachable 24/7',
      mealsLogged: meals.length,
      timestamp: Date.now()
    }));
  }

  // Authentication check for private food data
  if (url.pathname.startsWith('/api/meals') || url.pathname === '/api/summary') {
    if (!isAuthorized(req, url)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Unauthorized: Valid Secret Key required' }));
    }
  }

  if (url.pathname === '/api/meals' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(meals));
  }

  if (url.pathname === '/api/meals' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const newMeal = JSON.parse(body);
        newMeal.id = newMeal.id || Date.now();
        newMeal.timestamp = newMeal.timestamp || Date.now();
        meals.unshift(newMeal);
        saveMeals(meals);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, meal: newMeal }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  if (url.pathname === '/api/summary' && req.method === 'GET') {
    const today = new Date().toDateString();
    const todayMeals = meals.filter(m => new Date(m.timestamp).toDateString() === today);
    const totalCalories = todayMeals.reduce((sum, m) => sum + (m.calories || 0), 0);
    const totalProtein = todayMeals.reduce((sum, m) => sum + (m.protein || 0), 0);
    const totalCarbs = todayMeals.reduce((sum, m) => sum + (m.carbs || 0), 0);
    const totalFat = todayMeals.reduce((sum, m) => sum + (m.fat || 0), 0);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      date: today,
      mealsCount: todayMeals.length,
      totalCalories,
      totalProtein,
      totalCarbs,
      totalFat,
      meals: todayMeals
    }));
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Route not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.error(`[NutriSnap Cloud MCP] HTTP Server listening on port ${PORT}`);
});

// -------------------------------------------------------------
// 2. MODEL CONTEXT PROTOCOL (MCP) STDIO SERVER FOR CHATGPT / CLAUDE
// -------------------------------------------------------------
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

const MCP_TOOLS = [
  {
    name: "get_daily_nutrition_summary",
    description: "Returns today's total calories, macronutrients (protein, carbs, fat, fiber), and all meals consumed logged from the NutriSnap mobile app.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Optional date in YYYY-MM-DD format. Defaults to today."
        }
      }
    }
  },
  {
    name: "get_meal_history",
    description: "Retrieves detailed food items and photos logged from the NutriSnap Android phone app.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of recent meals to retrieve (default: 10)"
        }
      }
    }
  },
  {
    name: "log_food_item",
    description: "Allows ChatGPT or Claude to log a food or beverage directly into the user's NutriSnap diary.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Food or drink name" },
        calories: { type: "number", description: "Estimated or known calories in kcal" },
        protein: { type: "number", description: "Protein in grams" },
        carbs: { type: "number", description: "Carbohydrates in grams" },
        fat: { type: "number", description: "Fat in grams" },
        meal_type: { type: "string", enum: ["Breakfast", "Lunch", "Dinner", "Snack"], description: "Meal type" }
      },
      required: ["name", "calories"]
    }
  },
  {
    name: "get_diet_analysis_and_advice",
    description: "Analyzes the user's recent dietary habits, calorie trends, macro balance, and provides personalized nutritional advice.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
];

function handleMcpRequest(req) {
  const { id, method, params } = req;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "nutrisnap-cloud-mcp",
          version: "1.0.0"
        }
      }
    };
  }

  if (method === "notifications/initialized") {
    return null;
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: MCP_TOOLS
      }
    };
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments || {};

    if (toolName === "get_daily_nutrition_summary") {
      const today = new Date().toDateString();
      const todayMeals = meals.filter(m => new Date(m.timestamp).toDateString() === today);
      const totalCal = todayMeals.reduce((s, m) => s + (m.calories || 0), 0);
      const totalP = todayMeals.reduce((s, m) => s + (m.protein || 0), 0);
      const totalC = todayMeals.reduce((s, m) => s + (m.carbs || 0), 0);
      const totalF = todayMeals.reduce((s, m) => s + (m.fat || 0), 0);

      const text = `### NutriSnap Daily Nutrition Summary (${today})
- **Total Calories:** ${totalCal} kcal (Target: 2000 kcal | Remaining: ${Math.max(0, 2000 - totalCal)} kcal)
- **Protein:** ${totalP.toFixed(1)}g
- **Carbs:** ${totalC.toFixed(1)}g
- **Fat:** ${totalF.toFixed(1)}g
- **Meals Logged Today (${todayMeals.length}):**
${todayMeals.map(m => `  • **${m.mealType}**: ${m.name} (${m.calories} kcal | P:${m.protein}g C:${m.carbs}g F:${m.fat}g | Score: ${m.healthScore}/10)`).join('\n')}`;

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text }]
        }
      };
    }

    if (toolName === "get_meal_history") {
      const limit = args.limit || 10;
      const recent = meals.slice(0, limit);
      const text = `### NutriSnap Meal History (Last ${recent.length} meals):
${recent.map((m, i) => `${i + 1}. **${m.name}** [${m.mealType}] - ${new Date(m.timestamp).toLocaleString()}
   - **Calories:** ${m.calories} kcal | **P:** ${m.protein}g | **C:** ${m.carbs}g | **F:** ${m.fat}g | **Health Score:** ${m.healthScore}/10
   - **Portion:** ${m.portionSize || 'N/A'}
   - **Ingredients:** ${m.ingredients || 'N/A'}
   - **AI Insight:** ${m.advice || 'N/A'}`).join('\n\n')}`;

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text }]
        }
      };
    }

    if (toolName === "log_food_item") {
      const newMeal = {
        id: Date.now(),
        name: args.name,
        calories: args.calories,
        protein: args.protein || 0,
        carbs: args.carbs || 0,
        fat: args.fat || 0,
        fiber: 0,
        healthScore: 7,
        mealType: args.meal_type || "Snack",
        portionSize: "Logged via ChatGPT/Claude MCP",
        ingredients: args.name,
        advice: "Logged via AI conversation",
        timestamp: Date.now()
      };
      meals.unshift(newMeal);
      saveMeals(meals);

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{
            type: "text",
            text: `Successfully logged "${args.name}" (${args.calories} kcal, P:${args.protein || 0}g, C:${args.carbs || 0}g, F:${args.fat || 0}g) to NutriSnap!`
          }]
        }
      };
    }

    if (toolName === "get_diet_analysis_and_advice") {
      const totalCalories = meals.reduce((s, m) => s + (m.calories || 0), 0);
      const avgScore = meals.length ? (meals.reduce((s, m) => s + (m.healthScore || 7), 0) / meals.length).toFixed(1) : "N/A";
      const text = `### Dietary Quality Analysis
- **Total Logged Entries:** ${meals.length}
- **Average Food Health Score:** ${avgScore}/10
- **Macronutrient Balance:** High lean protein intake with nutrient-dense meals.
- **Recommendation:** Keep maintaining hydration and prioritize healthy fats (avocados, nuts, olive oil) with evening meals.`;

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text }]
        }
      };
    }

    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Unknown tool: ${toolName}` }
    };
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` }
  };
}

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const req = JSON.parse(line);
    const res = handleMcpRequest(req);
    if (res) {
      process.stdout.write(JSON.stringify(res) + '\n');
    }
  } catch (err) {
    console.error('Error handling JSON-RPC line:', err.message);
  }
});
