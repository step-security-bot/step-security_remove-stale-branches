import * as github from "@actions/github";
import * as core from "@actions/core";
import { removeStaleBranches } from "./removeStaleBranches";
import { Params } from "./types";
import useFakeTimers = jest.useFakeTimers;
import fs from "fs";
import axios, { isAxiosError } from "axios";

async function validateSubscription() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  let repoPrivate: boolean | undefined;

  if (eventPath && fs.existsSync(eventPath)) {
    const eventData = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    repoPrivate = eventData?.repository?.private;
  }

  const upstream = "fpicalausa/remove-stale-branches";
  const action = process.env.GITHUB_ACTION_REPOSITORY;
  const docsUrl =
    "https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions";

  core.info("");
  core.info("\u001b[1;36mStepSecurity Maintained Action\u001b[0m");
  core.info(`Secure drop-in replacement for ${upstream}`);
  if (repoPrivate === false)
    core.info("\u001b[32m\u2713 Free for public repositories\u001b[0m");
  core.info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`);
  core.info("");

  if (repoPrivate === false) return;

  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const body: Record<string, string> = { action: action || "" };
  if (serverUrl !== "https://github.com") body.ghes_server = serverUrl;
  try {
    await axios.post(
      `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
      body,
      { timeout: 3000 },
    );
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 403) {
      core.error(
        `\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m`,
      );
      core.error(
        `\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`,
      );
      process.exit(1);
    }
    core.info("Timeout or API not reachable. Continuing to next step.");
  }
}

function getRunConfig(): Params {
  const isDryRun = core.getBooleanInput("dry-run", { required: false });
  const repositoryInput = core.getInput("repository", { required: false });
  let repo: { owner: string; repo: string };
  if (repositoryInput) {
    const parts = repositoryInput.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(
        `Invalid repository input '${repositoryInput}': expected format 'owner/repo'`,
      );
    }
    repo = { owner: parts[0], repo: parts[1] };
  } else {
    repo = github.context.repo;
  }
  const protectedOrganizationName = core.getInput("exempt-organization", {
    required: false,
  });
  const selectedBranchesRegex = core.getInput("restrict-branches-regex", {
    required: false,
  });
  const protectedBranchesRegex = core.getInput("exempt-branches-regex", {
    required: false,
  });
  const protectedAuthorsRegex = core.getInput("exempt-authors-regex", {
    required: false,
  });
  const exemptProtectedBranches = core.getBooleanInput(
    "exempt-protected-branches",
    {
      required: false,
    },
  );
  const staleCommentMessage = core.getInput("stale-branch-message", {
    required: false,
  });
  const daysBeforeBranchStale = Number.parseInt(
    core.getInput("days-before-branch-stale", { required: false }),
  );
  const daysBeforeBranchDelete = Number.parseInt(
    core.getInput("days-before-branch-delete", { required: false }),
  );
  const operationsPerRun = Number.parseInt(
    core.getInput("operations-per-run", { required: false }),
  );

  const defaultRecipient =
    core.getInput("default-recipient", { required: false }) ?? "";

  const remapAuthorsInput = core.getInput("remap-authors", { required: false });
  let remapAuthors: unknown = {};
  if (remapAuthorsInput) {
    try {
      remapAuthors = JSON.parse(remapAuthorsInput);
    } catch (e) {
      throw new Error(
        `Invalid JSON for input 'remap-authors': ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  if (
    !remapAuthors ||
    Array.isArray(remapAuthors) ||
    typeof remapAuthors !== "object"
  ) {
    throw new Error("unexpected input: remap-authors is not a json object");
  }

  const ignoreUnknownAuthors = core.getBooleanInput("ignore-unknown-authors", {
    required: false,
  });

  const ignoreBranchesWithOpenPRs = core.getBooleanInput(
    "ignore-branches-with-open-prs",
    { required: false },
  );
  return {
    isDryRun,
    repo,
    protectedOrganizationName,
    selectedBranchesRegex,
    protectedBranchesRegex,
    protectedAuthorsRegex,
    exemptProtectedBranches,
    staleCommentMessage,
    daysBeforeBranchStale,
    daysBeforeBranchDelete,
    operationsPerRun,
    defaultRecipient,
    remapAuthors,
    ignoreUnknownAuthors,
    ignoreBranchesWithOpenPRs,
  };
}

async function run(): Promise<void> {
  await validateSubscription();
  const githubToken = core.getInput("github-token", { required: true });
  const octokit = github.getOctokit(githubToken);

  const runConfig = getRunConfig();

  try {
    const { summary, details } = await removeStaleBranches(octokit, runConfig);

    core.setOutput("scanned_branches", summary.scanned);
    core.setOutput("removed_branches", details.remove);
    core.setOutput("removed_branches_count", summary.remove);
    core.setOutput("new_stale_branches", details["mark stale"]);
    core.setOutput("new_stale_branches_count", summary["mark stale"]);
    core.setOutput("existing_stale_branches_count", summary["keep stale"]);
  } catch (e) {
    if (e && typeof e === "object" && e instanceof Error) {
      core.setFailed(e);
    }
  }
}

run();
