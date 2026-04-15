

# Replace "From Web to App" with This Tchurch App

## The Problem

The cross-project tools only allow **reading from** and **copying assets to** the current project. I cannot write files into the "From Web to App" project from here.

## How to Do It

You need to open the **[From Web to App](/projects/94a7da32-0c68-4f20-bb70-b8713bd1acb7)** project in Lovable and tell the AI there:

> Replace all the code in this project with the code from @Tchurch (reference this project using the @ mention). Copy every file from that project into this one, replacing all existing files. This is a React + Vite + Tailwind + TypeScript app with Clerk auth, Paddle payments, and Capacitor for mobile. Delete any files that don't exist in the source project.

That project's AI will be able to use the cross-project tools to read all files from this Tchurch project and write them into "From Web to App", which will then sync to your GitHub repo.

## Steps

1. Open [From Web to App](/projects/94a7da32-0c68-4f20-bb70-b8713bd1acb7)
2. Use `@Tchurch` to reference this project in the chat
3. Ask it to replace all files with the ones from this project
4. The changes will automatically sync to your connected GitHub repo

