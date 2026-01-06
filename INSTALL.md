# NapCatQQ Installation & Configuration

## Database Configuration

NapCatQQ now supports persistent message storage using MySQL or PostgreSQL.

### Prerequisites

- Node.js >= 18
- MySQL >= 5.7 or PostgreSQL >= 10
- Redis >= 5.0 (Optional, for caching)

### Configuration

Add the following `db` configuration to your `napcat.json` or config file:

```json
{
  "db": {
    "enable": true,
    "type": "mysql", // or "postgres"
    "host": "localhost",
    "port": 3306,
    "username": "root",
    "password": "your_password",
    "database": "napcat_msg",
    "redisHost": "localhost",
    "redisPort": 6379,
    "redisPassword": ""
  }
}
```

### Setup

1. Create the database (e.g., `CREATE DATABASE napcat_msg;`).
2. NapCatQQ will automatically create tables on first run.

### Migration

To run migrations manually or check database status, you can use the built-in tools (Coming Soon).
