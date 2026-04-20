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
* **Read-Only Safety:** Ensures database integrity by restricting LLM-generated operations to `SELECT` statements.

## Database Integrity & Performance
To ensure QueryFlow remains scalable and accurate, the project incorporates advanced architectural principles:
* **Schema Optimization:** Designed to avoid redundancy and prevent database inconsistency, ensuring the AI is querying a "Single Source of Truth."
* **Performance Agents:** Utilizes AI logic to suggest indices and table decompositions, optimizing query execution time for large datasets.
* **High-Fidelity MVP:** By grounding the AI in a fixed schema rather than open-ended file uploads, we ensure a stable and reliable user experience.
