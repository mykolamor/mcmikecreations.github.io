---
title: 'The Basics of Databases'
date: '2026-11-12'
description: Everything you need to know to read my database posts
author: Mykola Morozov
tags:
  - Databases
draft: true
techTree:
  timelines: [query-processing]
  year: 1970
  intro: true
---
# The Basics of Databases

I had a recent discussion with a friend about my current struggles with
databases and realized that there's a big knowledge gap about what
they are. I'm making this post for two reasons: correct the record for
people vaguely familiar with databases, and give an introduction to those who
know nothing about them.

## What is a database

There are a lot of interchangeable terms people use when talking about DBs.
I will also mix them up down the line, but for this post specifically, I will
make sure I use the correct term.

- **Database** - the rules and structure that can be found in a collection of
data (the blueprint/schema, logical model).
- **Database Instance** - an actual example of this structured data governed by
the given rules (the data constructed following the blueprint).
- **Database Engine** - the specific software used to process the raw data,
including storage (creating, reading, updating, securing data, enforcing the
rules).
- **Database Management System** (DBMS) - the full software package, including
network protocols, user management, backups, request processing, etc.

Most of the interesting research, subjectively, happens on the database engine
side, so future posts will use DB and database engine interchangeably.
Now for a more concrete example.

The following definition of a table is, in fact, a **database**.
- The identifier is a whole natural number ranging from $1$ to $2^{32}$;
- the country codes have to be lowercase alphabetic latin 3-letter words
  following the ISO 3166-1 alpha-3 standard (eng, ukr, deu, etc.);
- the currency codes have to be lowercase alphabetic latin 3-letter words
  following the ISO 4217 standard (eur, usd, uah).

|Identifier|CountryCode|CurrencyCode|
|--|--|--|
|  |  |  |

Once we actually fill this table with data, it becomes a **database instance**:

|Identifier|CountryCode|CurrencyCode|
|--|--|--|
|1|deu|eur|
|2|usa|usd|
|3|ukr|uah|

To add or remove rows to this table, and save the table to disk, we'd use
a **database engine**. And when our sysadmin wants to set up automatic
backups of the database instance across the network as part of their
central management system, they'd interact with the **DBMS**.

I want to emphasize here that structured data *DOES NOT* need to be a table.
Data comes in many forms, and there are many ways to organize it (graphs,
nested structures, documents).

## Database Management Systems

Now that we've established what they are on a surface level, we need to talk
about the components of a typical DBMS.

They can be largely broken down into three categories:
- frontend
- backend
- control

The **frontend** components, among others, include:
- client access interfaces like CLI (text-only terminal control), GUI
(interactive apps), web console (locally run website connected to the DBMS);
- APIs and drivers like ODBC, JDBC, wire protocol (connections programmers can
use to access the DBMS in their programs);
- client connection management (how many users can connect to which DBMS on
which computer);
- query processing (parsing and transforming the query DBMS receives as text or
otherwise);
- analysis and estimation (checking information stored in the database instance
to come up with faster ways to process this information exploiting qualities and
statistics the data has);
- arguably optimization, final execution plan generation (more on this below);
- extension and plugin management.

In simple terms, frontend components help the DBMS, the surrounding systems, and
the users to interact with each other. The requests to process data enter the
frontend components, get set up in the control components, and get executed by
the backend components.

The **backend** components then include:
- low-level query optimization and/or compilation (more on it below);
- actual processing operation implementations in code;
- storage management (storing and loading information to disk or over Internet);
- computation and usage of additional information (sorted copies of data,
pre-computed relations between information pieces);
- compression, encoding, encryption, low-level security;
- memory management (allocating and occupying new memory chunks of the computer
that runs the DBMS, cleaning up after the data was processed).

In short, backend components are the backbone of the DBMS, actually executing
the information processing commands issued by users or other systems.
There have been some successful systems foregoing frontend components and
focusing on making backend ones easy to use and integrate into other systems
(since these data processing operations, storage management, etc. have usage
outside of databases, in medical programs, document editors, statistics
gathering dashboards and so on). Frontend components, however, make no sense to
exist without backend components supporting them.

The control components hold everything together and help components in other
categories to talk to each other and get work done. They include:
- transactions (ensuring only one user changes the same piece of information
at a time to avoid wrong data);
- concurrency control (executing operations across many computers, executing
many operations on one computer, etc.);
- deadlock detection (many users trying to change the same information and the
system getting stuck trying to do it);
- recovery (restarting if the system crashes, making checkpoints to resume from,
tracking and reporting the progress);
- authentication/authorization, user access;
- auditing and data masking for privacy;
- computer resource management and distribution to different operations;
- pefrormance, error, event monitoring;
- backups and restores automation, tool reorganization (e.g., recomputing that
pre-calculated sorted data when it changes);
- distribution of tasks and operations between different database engines,
computers running the DBMS, etc.

Although there are a lot of components attributed to the control category, they
are mostly responsible for ensuring the user queries get executed, the system
works reliably, and the computers running the DBMS are doing work.

## Database Types

Now that we've discussed topics that apply to all sorts of databases, we need to
figure out what aforementioned sorts of databases exist. There are a lot of
them, and a lot of categorizations too, but here's the one I like to use.

**Relational (SQL) Databases**. The information stored inside is organized into
tables records (information objects), and relations are described between them.
The table above is an example of a relational database instance. Modern DBMS
falling into this category include *PostgreSQL, MySQL, OracleDB, SQLite* and
more. Since this category is heavily structured and broken down into separate
tables, processing them and finding relevant pieces of information can get quite
complex.

**Document Databases**. Information is stored in semi-structured documents, in
practice mostly in JSON/BSON formats. These databases allow storing more
varying and freeform data, but often include duplicates and deeply nested
data structures, making processing them more difficult. Examples include
*MongoDB, Couchbase, Firestore*.

**Key-Value Databases**. Every piece of information is assigned a key, when it
is added to the database instance. This key can then be used to retrieve or
change this information. While this category of databases is less flexible, it
can use some unique assumptions and optimizations to make data processing
faster. This category includes *Redis, DynamoDB, RocksDB*, etc.

**Graph Databases**. The information stored in an instance of a graph database
represents a network of different objects and their connections. Operations
on these databases are often more complex, traversing the network and gathering
information. There are meaningful subtypes of graph databases, like with all
other categories, but I won't go into them here.

There are many more specialized categories that I won't touch on for now, often
focusing on specific data formats, workloads, or use cases. To name a few,
vector databases operate on multidimensional vectors that represent information
points in multidimensional space; time-series databases track all data using
events or measurements happening at a given time; geospatial databases focus on
representing and processing geographical data, or in general any data tied to
a specific position in space; blockchain/ledger databases store information
in unchangeable chunks that can only be read or added, not modified or removed;
flat file databases work directly on the file system on a computer. I hope to
cover all of these at some point in the future, but for now let's focus on the
basics.

There are other categorizations of databases, independent of (or complimentary
to) the ones above. Someone can group databases by storage location (on disk or
only inside the operating memory of a computer), by workload (many small
transactions adding, updating, and deleting data; large statistical computations
over unchanging data; mixed workloads; data continuously streaming from outside
sources and being processed on-the-go), by architecture (embedded,
client-server, distributed across many computers and centrally managed,
federated and running tasks across multiple independent computers), by
deployment (where the DBMS is running, so local/self-hosted, cloud, etc.).

There are many DBMS nowadays, so any time a new one is born, developers need to
figure out which categories they want to focus on, and how they would
differentiate their new system from existing ones.

Many more topics, categorizations, and cool database facts await us in the
future, but this is a good point to stop for now. You can find the whole
timeline of database research I reviewed on the [SmackDB project page](/projects/smackdb/).
