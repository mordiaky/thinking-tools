CREATE TABLE `argument_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`argument_id` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`parent_node_id` text,
	`strength` text DEFAULT 'medium',
	`source` text,
	`created_at` text,
	FOREIGN KEY (`argument_id`) REFERENCES `arguments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `arguments` (
	`id` text PRIMARY KEY NOT NULL,
	`topic` text NOT NULL,
	`conclusion` text,
	`status` text DEFAULT 'building' NOT NULL,
	`created_at` text,
	`updated_at` text,
	`tags` text DEFAULT '[]'
);
--> statement-breakpoint
CREATE TABLE `assumptions` (
	`id` text PRIMARY KEY NOT NULL,
	`statement` text NOT NULL,
	`context` text,
	`status` text DEFAULT 'untested' NOT NULL,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`evidence` text,
	`source` text,
	`impact` text DEFAULT 'medium' NOT NULL,
	`created_at` text,
	`updated_at` text,
	`tested_at` text,
	`tags` text DEFAULT '[]'
);
--> statement-breakpoint
CREATE TABLE `beliefs` (
	`id` text PRIMARY KEY NOT NULL,
	`statement` text NOT NULL,
	`domain` text,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`source` text,
	`created_at` text,
	`updated_at` text,
	`tags` text DEFAULT '[]'
);
--> statement-breakpoint
CREATE TABLE `confidence_history` (
	`id` text PRIMARY KEY NOT NULL,
	`hypothesis_id` text NOT NULL,
	`confidence` real NOT NULL,
	`reason` text NOT NULL,
	`created_at` text,
	FOREIGN KEY (`hypothesis_id`) REFERENCES `hypotheses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contradictions` (
	`id` text PRIMARY KEY NOT NULL,
	`belief_a_id` text NOT NULL,
	`belief_b_id` text NOT NULL,
	`explanation` text NOT NULL,
	`status` text DEFAULT 'unresolved' NOT NULL,
	`resolution` text,
	`created_at` text,
	`resolved_at` text,
	FOREIGN KEY (`belief_a_id`) REFERENCES `beliefs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`belief_b_id`) REFERENCES `beliefs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `critiques` (
	`id` text PRIMARY KEY NOT NULL,
	`idea_id` text NOT NULL,
	`content` text NOT NULL,
	`wrapper_problem` text,
	`existing_products` text,
	`fragile_dependencies` text,
	`vague_statement` text,
	`violates_software_only` text,
	`overall_verdict` text,
	`verdict_reasoning` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `decision_criteria` (
	`id` text PRIMARY KEY NOT NULL,
	`decision_id` text NOT NULL,
	`name` text NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`description` text,
	`created_at` text,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `decision_options` (
	`id` text PRIMARY KEY NOT NULL,
	`decision_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `decision_ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`option_id` text NOT NULL,
	`criterion_id` text NOT NULL,
	`score` real NOT NULL,
	`reasoning` text,
	`created_at` text,
	FOREIGN KEY (`option_id`) REFERENCES `decision_options`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`criterion_id`) REFERENCES `decision_criteria`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'open' NOT NULL,
	`chosen_option_id` text,
	`decided_at` text,
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`hypothesis_id` text NOT NULL,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`weight` real DEFAULT 0.5 NOT NULL,
	`source` text,
	`confidence_before` real NOT NULL,
	`confidence_after` real NOT NULL,
	`created_at` text,
	FOREIGN KEY (`hypothesis_id`) REFERENCES `hypotheses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fermentation_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`idea_id` text NOT NULL,
	`alert_type` text NOT NULL,
	`previous_composite` real NOT NULL,
	`new_composite` real NOT NULL,
	`delta` real NOT NULL,
	`triggered_at` text NOT NULL,
	`acknowledged_at` text,
	FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `hypotheses` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`context` text,
	`created_at` text,
	`updated_at` text,
	`resolved_at` text,
	`resolution` text,
	`final_evidence` text
);
--> statement-breakpoint
CREATE TABLE `idea_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`domain` text,
	`candidate_count` integer NOT NULL,
	`pass_count` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `idea_tags` (
	`idea_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`idea_id`, `tag_id`),
	FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `idea_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`idea_id` text NOT NULL,
	`mutation_axis` text,
	`mutation_depth` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`one_liner` text NOT NULL,
	`problem` text NOT NULL,
	`solution` text NOT NULL,
	`why_now` text,
	`target_user` text,
	`constraints` text,
	`risks` text,
	`mvp_steps` text,
	`domain` text,
	`status` text DEFAULT 'raw' NOT NULL,
	`re_validated_at` text,
	`last_scored_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `learning_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_type` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`lesson` text,
	`context` text,
	`severity` text DEFAULT 'medium',
	`created_at` text,
	`updated_at` text,
	`tags` text DEFAULT '[]'
);
--> statement-breakpoint
CREATE TABLE `mental_model_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`model_name` text NOT NULL,
	`problem` text NOT NULL,
	`analysis` text NOT NULL,
	`insights` text,
	`created_at` text,
	`updated_at` text,
	`tags` text DEFAULT '[]'
);
--> statement-breakpoint
CREATE TABLE `rejection_patterns` (
	`id` text PRIMARY KEY NOT NULL,
	`pattern_text` text NOT NULL,
	`source_critique_id` text,
	`frequency_count` integer DEFAULT 1 NOT NULL,
	`last_seen` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_critique_id`) REFERENCES `critiques`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rejection_patterns_pattern_text_unique` ON `rejection_patterns` (`pattern_text`);--> statement-breakpoint
CREATE TABLE `scores` (
	`id` text PRIMARY KEY NOT NULL,
	`idea_id` text NOT NULL,
	`novelty` real NOT NULL,
	`usefulness` real NOT NULL,
	`feasibility` real NOT NULL,
	`testability` real NOT NULL,
	`speed_to_mvp` real NOT NULL,
	`defensibility` real NOT NULL,
	`clarity` real NOT NULL,
	`composite` real NOT NULL,
	`novelty_reasoning` text,
	`usefulness_reasoning` text,
	`feasibility_reasoning` text,
	`testability_reasoning` text,
	`speed_to_mvp_reasoning` text,
	`defensibility_reasoning` text,
	`clarity_reasoning` text,
	`score_type` text DEFAULT 'initial' NOT NULL,
	`market_context` text,
	`rubric_snapshot` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);