# QueryFlow 
**Empowering Product Managers and Analysts through Natural Language Data Intelligence.**

QueryFlow is an AI-powered data assistant designed to bridge the gap between non-technical stakeholders and complex relational databases. By translating natural language into executable SQL and dynamic web visualizations, QueryFlow reduces "Insight Latency" from hours to seconds.

## Executive Summary
In many organizations, the path from a business question to a data-driven answer is blocked by a technical "SQL barrier." QueryFlow democratizes data access by functioning as a virtual analyst. It doesn't just provide data; it interprets intent, handles ambiguity, and renders interactive visual stories—all within a single conversational interface.

## How It Works
QueryFlow follows a robust three-step execution chain grounded in a fixed, well-documented database schema.

1.  **Text-to-SQL (Few-Shot Grounding):**
    The system pairs the user’s natural language prompt with the database and schema notes. Rather than relying on fine-tuned models, QueryFlow uses prompt engineering to generate precise, read-only SQL queries.
2.  **Data Extraction:**
    The system executes the generated SQL against the backend database. Results are directly structured for immediate processing.
3.  **Gen-Viz (Dynamic Web Visualization):**
    The LLM analyzes the resulting data structure (column names and sample values) to write a configuration spec for **Chart.js**. This JSON object is rendered natively on the client without arbitrary code execution, providing an interactive chart safely in the browser.

## Key Features
* **Natural Language Interface:** Ask questions like *"Which artists sold the most tracks?"* and receive an interactive chart in return.
* **Ambiguity Resolution:** The agent identifies vague terms (e.g., "most popular") and asks for clarification—offering to filter by track copies or total revenue.
* **Mixed-Initiative Design:** Users can "tweak" results in real-time (e.g., *"Make the bars red"*, *"Change to a line chart"*) through a continuous conversational loop.
* **Voice Input (Speech-to-Text):** Integrated native Web Speech API allows users to dictate complex queries quickly without typing.
* **Business Recommendations Engine:** Automatically synthesize active session history (questions, SQL run, and insights) into structured, professional markdown memos containing Executive Summaries, Key Findings, and Recommended Actions.
* **Read-Only Safety:** Ensures database integrity by restricting LLM-generated operations to `SELECT` statements.

## Database Integrity, Rendering, & Performance
To ensure QueryFlow remains scalable and accurate, the project incorporates advanced architectural principles:
* **Payload Management Optimization:** Smartly strips large raw data rows (such as thousands of boxplot points) before persistence, keeping the database light and preventing payload limit errors. Only the lightweight chart configurations and metadata are saved.
* **Smarter Chart Rendering:** Deterministic post-processors automatically filter out ID-like and Year-like meta-columns from being accidentally plotted as primary numeric metrics, ensuring clean visual scaling and data representation.
* **Schema Optimization:** Designed to avoid redundancy and prevent database inconsistency, ensuring the AI is querying a "Single Source of Truth."
* **High-Fidelity MVP:** By grounding the AI in a fixed schema (ChinookDB) rather than open-ended file uploads, we ensure a stable and reliable user experience.

## AI Model & Setup
QueryFlow is powered by an optimized multi-agent pipeline. 
* **Model Configuration:** The default inference engine is `gemma4:31b-cloud`. This model delivers fantastic efficiency for live demonstrations, and its free-tier usage perfectly handles complex SQL generation, gatekeeping, and visualization formatting seamlessly.

## Usage
Currently, the application runs locally and targets the included **Chinook SQLite dataset** by default.

Before starting the application, you must create a `.env` file in the root directory with your AI configuration credentials. For example:
```env
OLLAMA_API_KEY=your_api_key_here
OLLAMA_BASE=https://ollama.com
OLLAMA_MODEL=gemma4:31b-cloud
```

To run the application, you need to start both the client and the server:
1. **Start the backend server:** (Handles SQLite queries and AI agent orchestration)
   ```bash
   npm run server
   ```
2. **Start the frontend application:** (Vite/React dev server)
   ```bash
   npm run dev
   ```

## Future Roadmap & Next Steps
While the current MVP is grounded in the static Chinook database, the next phase of QueryFlow focuses on dynamic adaptability and **Self-Learning Data Ingestion**.

* **Model Context Protocol (MCP) Integration:** Moving away from a hardcoded schema, the plan is to implement MCP.
* **Self-Learning Context Generation:** When a user provides database credentials, the AI will autonomously:
  1. Query the database to extract all table schemas and column metadata.
  2. Map out relationships, foreign keys, and primary indices.
  3. Seamlessly inject this newly learned schema into its own agentic context.
  
This will allow QueryFlow to be deployed on top of any organization's custom data warehouse instantly, without manual schema configuration.
