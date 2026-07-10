use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use chrono::Local;
use super::contradictions::{Contradiction, ContradictionClaimRef, ContradictionStatus, JudgeVote};
use super::ensemble;
use super::claims::{self, Claim, ClaimSource, ClaimHistoryEntry};
use super::decay::{FreshnessState, DomainVolatility};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalClaim {
    pub path: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalCase {
    pub case_id: String,
    pub claim_a: EvalClaim,
    pub claim_b: EvalClaim,
    pub new_evidence: String,
    pub ground_truth_verdict: String,
    pub ground_truth_reasoning: String,
    pub labeled_by: String,
    pub labeled_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JudgeStats {
    pub judge_id: String,
    pub correct: usize,
    pub false_positive: usize,
    pub false_negative: usize,
    pub fpr: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregatedEvalResults {
    pub run_id: String,
    pub run_at: String,
    pub total_cases: usize,
    pub single_judge: JudgeStats,
    pub ensemble: JudgeStats,
    pub fpr_reduction_pct: f64,
    pub notes: String,
}

fn seed_sample_cases(cases_path: &Path) -> Result<(), String> {
    let mut cases = Vec::new();
    let sample_data = vec![
        ("eval_001", "GPT-4 has 1.8 trillion parameters", "GPT-4 has 1.76 trillion parameters", "Official leaks and teardowns confirm the model consists of 16 MoE experts, each with 110 billion parameters, totaling 1.76 trillion parameters.", "merge", "Both represent rounding of the same architectural parameters."),
        ("eval_002", "Rust was created by Graydon Hoare", "Rust was designed by Mozilla", "Graydon Hoare initially designed the language as a personal project, which Mozilla began sponsoring in 2009.", "merge", "Both statements are correct and compatible in context."),
        ("eval_003", "React 19 was released in 2024", "React 19 was released in 2026", "React 19 reached general availability on December 5, 2024.", "accept_a", "React 19 GAA release date is December 5, 2024. Claim B is incorrect."),
        ("eval_004", "Tauri uses Electron under the hood", "Tauri uses WRY and webview libraries", "Tauri is a framework that uses system webviews through WRY, not Chromium/Node.js like Electron.", "accept_b", "Tauri does not use Electron. Claim B is correct."),
        ("eval_005", "WikiMind uses LanceDB vector store", "WikiMind uses Pinecone vector database", "WikiMind architecture documentation states LanceDB is used for local filesystem vector storage.", "accept_a", "WikiMind uses local LanceDB embeddings. Claim B is incorrect."),
        ("eval_006", "The project identifier is com.wikimind.app", "The project identifier is com.llmwiki.app", "Tauri configuration (tauri.conf.json) defines the app identifier as com.wikimind.app.", "accept_a", "com.wikimind.app is the official identifier post-rebranding."),
        ("eval_007", "GPT-4 context window is 8k tokens", "GPT-4 context window is 128k tokens", "Original GPT-4 supported 8k/32k tokens. GPT-4 Turbo (gpt-4-1106-preview) extended the context window to 128k tokens.", "merge", "Different versions of the model (base vs Turbo) support different contexts."),
        ("eval_008", "Rust 1.80 was released in 2024", "Rust 1.80 was released in 2025", "Rust 1.80.0 was released on July 25, 2024.", "accept_a", "Official Rust releases show 1.80.0 GA on July 25, 2024."),
        ("eval_009", "Claude 3.5 Sonnet has 200k context", "Claude 3.5 Sonnet has 100k context", "Anthropic documentation specifies Claude 3.5 Sonnet context length is 200,000 tokens.", "accept_a", "Claim A is correct according to official Anthropic specifications."),
        ("eval_010", "Python 2.7 support ended in 2020", "Python 2.7 support ended in 2018", "Python 2.7 officially reached End of Life (EOL) on January 1, 2020.", "accept_a", "EOL date was January 1, 2020."),
        ("eval_011", "Tauri v2 supports mobile platforms", "Tauri v2 only supports desktop platforms", "Tauri 2.0 includes first-class support for iOS and Android development.", "accept_a", "Tauri v2 has official mobile support. Claim B is incorrect."),
        ("eval_012", "SQLite is serverless and self-contained", "SQLite requires a background service running", "SQLite reads and writes directly to ordinary disk files, requiring no server setup.", "accept_a", "SQLite is local and serverless. Claim B is incorrect."),
        ("eval_013", "Vite is created by Evan You", "Vite is created by the Webpack team", "Vite was created by Evan You, the creator of Vue.js.", "accept_a", "Evan You is the creator of Vite."),
        ("eval_014", "Gemini 1.5 Pro context window is 2M tokens", "Gemini 1.5 Pro context window is 1M tokens", "Google extended Gemini 1.5 Pro's context window to 2 million tokens in developer preview.", "merge", "Context size varies between 1M standard and 2M developer preview."),
        ("eval_015", "Next.js uses App Router by default now", "Next.js uses Pages Router by default now", "Vercel recommends the App Router for new applications in their documentation.", "accept_a", "App Router is the recommended default since Next.js 13.4."),
        ("eval_016", "The decay scans run daily in WikiMind", "The decay scans run weekly in WikiMind", "The default schedule configuration cron for decay_scan is hourly or daily.", "merge", "Decay scan runs hourly or daily based on user configuration."),
        ("eval_017", "Zustand is a state manager for React", "Zustand is a database engine", "Zustand is a small, fast, and scalable bearbones state-management solution.", "accept_a", "Zustand is a React state library."),
        ("eval_018", "TypeScript compiles to assembly", "TypeScript compiles to JavaScript", "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.", "accept_b", "TS compiles to JS. Claim A is incorrect."),
        ("eval_019", "LanceDB is a serverless vector database", "LanceDB requires a dedicated Docker container", "LanceDB runs embedded inside your application process, requiring no external server.", "accept_a", "LanceDB is embedded and serverless."),
        ("eval_020", "Windows is a POSIX-compliant OS", "Windows is not POSIX-compliant natively", "Natively, Windows uses NT kernel and Win32 subsystems, though WSL provides Linux compatibility.", "accept_b", "Windows is not POSIX natively. WSL is a subsystem compatibility layer."),
        ("eval_021", "Python 3.12 was released in October 2023", "Python 3.12 was released in December 2023", "Official Python documentation confirms the final release of Python 3.12.0 occurred on October 2, 2023.", "accept_a", "Python 3.12 was released on October 2, 2023. Claim B is incorrect."),
        ("eval_022", "Java was created by James Gosling at Sun Microsystems", "Java was created by Microsoft", "Sun Microsystems developed Java and released Java 1.0 in 1996. Microsoft later created C#.", "accept_a", "Sun Microsystems and James Gosling created Java."),
        ("eval_023", "HTTP/3 uses TCP as transport", "HTTP/3 uses UDP/QUIC as transport", "The IETF specification states HTTP/3 runs on top of QUIC which uses UDP as transport.", "accept_b", "HTTP/3 uses QUIC/UDP, not TCP. Claim A is incorrect."),
        ("eval_024", "Docker macOS runs Linux kernel natively", "Docker macOS runs Linux inside a VM", "Docker Desktop on macOS uses a lightweight HyperKit virtual machine since the macOS kernel lacks Linux namespaces.", "accept_b", "Docker runs inside a Linux VM on macOS natively."),
        ("eval_025", "Linux kernel was first released in 1991", "Linux kernel was first released in 1995", "Linus Torvalds released the initial version 0.01 on September 17, 1991.", "accept_a", "The Linux kernel was first released in 1991."),
        ("eval_026", "Git was created by Linus Torvalds in 2005", "Git was created by GitHub in 2008", "Linus Torvalds designed and wrote the initial versions of Git in 2005 for Linux kernel development.", "accept_a", "Linus Torvalds created Git in 2005."),
        ("eval_027", "PostgreSQL default port is 5432", "PostgreSQL default port is 3306", "PostgreSQL defaults to listening on TCP port 5432. MySQL uses 3306.", "accept_a", "Port 5432 is the official PostgreSQL default."),
        ("eval_028", "Svelte uses a virtual DOM", "Svelte compiles components to direct DOM updates", "Svelte is a compiler that converts declarative components into precise, direct DOM manipulations without virtual DOM overhead.", "accept_b", "Svelte does not use a virtual DOM."),
        ("eval_029", "Kubernetes was designed by Google", "Kubernetes was designed by Amazon", "Kubernetes was originally designed by Google developers and open-source in 2014 before donation to CNCF.", "accept_a", "Google originally designed Kubernetes."),
        ("eval_030", "Chrome uses Blink layout engine", "Chrome uses WebKit layout engine", "Google forked WebKit in 2013 to create Blink, which now powers the Chromium project and Google Chrome browser.", "accept_a", "Blink is Chrome's current layout engine; WebKit is legacy."),
        ("eval_031", "C++ was designed by Bjarne Stroustrup", "C++ was designed by Dennis Ritchie", "Bjarne Stroustrup created C++ at Bell Labs as an extension of the C language, which Dennis Ritchie designed.", "accept_a", "Bjarne Stroustrup is the creator of C++."),
        ("eval_032", "Redux is a state manager for React", "Redux is a styling library", "Redux is a predictable state container for JavaScript apps, commonly used with React for global state.", "accept_a", "Redux is a state management library."),
        ("eval_033", "JSON stands for JavaScript Object Notation", "JSON stands for Joint Semantic Object Network", "The JSON specification defines it as JavaScript Object Notation, a lightweight data-interchange format.", "accept_a", "JSON stands for JavaScript Object Notation."),
        ("eval_034", "AWS S3 provides object storage", "AWS S3 provides block-level disk storage", "Amazon S3 is a flat namespace object storage service. EBS provides block storage.", "accept_a", "S3 is object-based, not block storage."),
        ("eval_035", "HTML5 was finalized in 2014", "HTML5 was finalized in 2018", "The W3C published HTML5 as a recommendation on October 28, 2014.", "accept_a", "HTML5 recommendation was finalized in 2014."),
        ("eval_036", "GraphQL was created by Meta/Facebook", "GraphQL was created by Netflix", "Facebook internally developed GraphQL in 2012 before releasing it publicly in 2015.", "accept_a", "GraphQL was created by Facebook/Meta."),
        ("eval_037", "Rust does not have a garbage collector", "Rust uses a mark-and-sweep garbage collector", "Rust manages memory via compile-time ownership rules and lifetime analysis without a runtime garbage collector.", "accept_a", "Rust has no runtime garbage collector."),
        ("eval_038", "Nginx was created by Igor Sysoev", "Nginx was created by Linus Torvalds", "Igor Sysoev wrote Nginx and released its first public version in October 2004.", "accept_a", "Igor Sysoev is the creator of Nginx."),
        ("eval_039", "Redis is an in-memory key-value database", "Redis stores all data on tape drives by default", "Redis is an open-source, in-memory data structure store used as a database, cache, and message broker.", "accept_a", "Redis is an in-memory database."),
        ("eval_040", "HTTP status 404 means Not Found", "HTTP status 404 means Server Error", "RFC 7231 specifies HTTP 404 indicates the origin server did not find a current representation for the target resource.", "accept_a", "404 is client error: Not Found."),
        ("eval_041", "Ruby on Rails uses MVC pattern", "Ruby on Rails uses ECS pattern", "Rails is an opinionated server-side web application framework structured around Model-View-Controller architecture.", "accept_a", "Rails is MVC-based."),
        ("eval_042", "WebAssembly runs in browsers", "WebAssembly only runs on mainframe computers", "WebAssembly is a binary instruction format for a stack-based virtual machine, designed to run in web browsers.", "accept_a", "WebAssembly is natively supported in modern browsers."),
        ("eval_043", "Vite uses esbuild for dependency pre-bundling", "Vite uses Webpack for dependency pre-bundling", "Vite documentation specifies it uses esbuild to pre-bundle dependencies during development.", "accept_a", "Vite uses esbuild for pre-bundling."),
        ("eval_044", "Swift was introduced by Apple in 2014", "Swift was introduced by Apple in 2018", "Apple introduced Swift at its Worldwide Developers Conference (WWDC) in June 2014.", "accept_a", "Swift was introduced in 2014."),
        ("eval_045", "PHP stands for Hypertext Preprocessor", "PHP stands for Perl Hypertext Program", "PHP originally stood for Personal Home Page, but now stands recursively for PHP: Hypertext Preprocessor.", "accept_a", "PHP stands for Hypertext Preprocessor."),
        ("eval_046", "SQLite stores database in a single file", "SQLite requires a cluster of 5 databases", "SQLite is an embedded database engine that stores its entire database structure in a single file.", "accept_a", "SQLite databases are single file based."),
        ("eval_047", "MongoDB is a document-oriented database", "MongoDB is a relational database", "MongoDB stores data in flexible JSON-like documents, classifying it as a NoSQL document database.", "accept_a", "MongoDB is a document/NoSQL database."),
        ("eval_048", "Pandas is a data analysis library for Python", "Pandas is a gaming engine", "Pandas is an open-source data manipulation and analysis library for the Python programming language.", "accept_a", "Pandas is for data analysis."),
        ("eval_049", "COBOL was developed in 1959", "COBOL was developed in 1989", "COBOL was designed in 1959 by CODASYL, inspired by Grace Hopper's work.", "accept_a", "COBOL was designed in 1959."),
        ("eval_050", "The standard SSH port is 22", "The standard SSH port is 80", "IANA assigns TCP port 22 for secure shell logins. Port 80 is for HTTP.", "accept_a", "Port 22 is the standard SSH port.")
    ];

    let now_date_str = Local::now().format("%Y-%m-%d").to_string();

    for (id, txt_a, txt_b, evidence, gt, reasoning) in sample_data {
        let case = EvalCase {
            case_id: id.to_string(),
            claim_a: EvalClaim {
                path: format!("claims/claim_a_{}.md", id),
                text: txt_a.to_string(),
            },
            claim_b: EvalClaim {
                path: format!("claims/claim_b_{}.md", id),
                text: txt_b.to_string(),
            },
            new_evidence: evidence.to_string(),
            ground_truth_verdict: gt.to_string(),
            ground_truth_reasoning: reasoning.to_string(),
            labeled_by: "system_seeder".to_string(),
            labeled_at: now_date_str.clone(),
        };
        cases.push(case);
    }

    let mut raw_lines = String::new();
    for case in cases {
        raw_lines.push_str(&serde_json::to_string(&case).unwrap());
        raw_lines.push('\n');
    }

    fs::write(cases_path, raw_lines)
        .map_err(|e| format!("Failed to write seeded evaluation cases: {e}"))?;

    Ok(())
}

fn create_temp_claim_files(project_path: &str, case: &EvalCase) -> Result<(), String> {
    let now_date_str = Local::now().format("%Y-%m-%d").to_string();

    let file_a = case.claim_a.path.strip_prefix("claims/").unwrap_or(&case.claim_a.path);
    let claim_a = Claim {
        title: case.claim_a.text.clone(),
        r#type: "claim".to_string(),
        confidence: 0.8,
        source_count: 1,
        last_verified: now_date_str.clone(),
        verification_count: 1,
        contradiction_count: 1,
        freshness_state: FreshnessState::Fresh,
        date: now_date_str.clone(),
        tags: vec!["evaluation".to_string()],
        domain_volatility: Some(DomainVolatility::Medium),
        description: Some(case.claim_a.text.clone()),
        sources: vec![ClaimSource {
            path: "eval/cases.jsonl".to_string(),
            page: None,
            excerpt: case.claim_a.text.clone(),
            verified_at: now_date_str.clone(),
            url: None,
        }],
        parent_concepts: vec![],
        contradictions: vec![],
        history: vec![],
        content: case.claim_a.text.clone(),
    };
    let _ = claims::create_claim(project_path, file_a, &claim_a);

    let file_b = case.claim_b.path.strip_prefix("claims/").unwrap_or(&case.claim_b.path);
    let claim_b = Claim {
        title: case.claim_b.text.clone(),
        r#type: "claim".to_string(),
        confidence: 0.8,
        source_count: 1,
        last_verified: now_date_str.clone(),
        verification_count: 1,
        contradiction_count: 1,
        freshness_state: FreshnessState::Fresh,
        date: now_date_str.clone(),
        tags: vec!["evaluation".to_string()],
        domain_volatility: Some(DomainVolatility::Medium),
        description: Some(case.claim_b.text.clone()),
        sources: vec![ClaimSource {
            path: "eval/cases.jsonl".to_string(),
            page: None,
            excerpt: case.claim_b.text.clone(),
            verified_at: now_date_str.clone(),
            url: None,
        }],
        parent_concepts: vec![],
        contradictions: vec![],
        history: vec![],
        content: case.claim_b.text.clone(),
    };
    let _ = claims::create_claim(project_path, file_b, &claim_b);

    Ok(())
}

fn cleanup_temp_claim_files(project_path: &str, case: &EvalCase) {
    let file_a = case.claim_a.path.strip_prefix("claims/").unwrap_or(&case.claim_a.path);
    let file_b = case.claim_b.path.strip_prefix("claims/").unwrap_or(&case.claim_b.path);
    
    let path_a = Path::new(project_path).join("wiki").join("claims").join(file_a);
    let path_b = Path::new(project_path).join("wiki").join("claims").join(file_b);

    let _ = fs::remove_file(path_a);
    let _ = fs::remove_file(path_b);
}

pub async fn run_evaluation(
    project_path: &str,
    app_handle: &tauri::AppHandle,
) -> Result<AggregatedEvalResults, String> {
    let eval_dir = Path::new(project_path).join(".wikimind").join("maintenance").join("eval");
    if !eval_dir.exists() {
        fs::create_dir_all(&eval_dir)
            .map_err(|e| format!("Failed to create eval directory: {e}"))?;
    }

    let cases_file = eval_dir.join("cases.jsonl");
    if !cases_file.exists() {
        seed_sample_cases(&cases_file)?;
    }

    let raw = fs::read_to_string(&cases_file)
        .map_err(|e| format!("Failed to read cases.jsonl: {e}"))?;

    let mut cases = Vec::new();
    for line in raw.lines() {
        if !line.trim().is_empty() {
            if let Ok(case) = serde_json::from_str::<EvalCase>(line) {
                cases.push(case);
            }
        }
    }

    if cases.is_empty() {
        return Err("No evaluation cases found".to_string());
    }

    let mut single_correct = 0;
    let mut single_fp = 0;
    let mut single_fn = 0;

    let mut ensemble_correct = 0;
    let mut ensemble_fp = 0;
    let mut ensemble_fn = 0;

    for case in &cases {
        // Create temp claims
        let _ = create_temp_claim_files(project_path, case);

        let temp_contra = Contradiction {
            title: format!("Dispute: {}", case.claim_a.text),
            r#type: "contradiction".to_string(),
            status: ContradictionStatus::Open,
            date: Local::now().format("%Y-%m-%d").to_string(),
            tags: vec!["evaluation".to_string()],
            claims: vec![
                ContradictionClaimRef {
                    path: case.claim_a.path.clone(),
                    position: case.claim_a.text.clone(),
                },
                ContradictionClaimRef {
                    path: case.claim_b.path.clone(),
                    position: case.claim_b.text.clone(),
                },
            ],
            judge_votes: Vec::new(),
            resolution_method: None,
            resolution: None,
            resolved_at: None,
            resolved_by: None,
            description: Some(case.ground_truth_reasoning.clone()),
            new_evidence: Some(case.new_evidence.clone()),
            content: String::new(),
        };

        if let Ok((verdict, votes)) = ensemble::run_ensemble(project_path, &temp_contra, app_handle).await {
            let gt = &case.ground_truth_verdict;
            
            // Single judge (first vote)
            if !votes.is_empty() {
                let sj_verdict = &votes[0].verdict;
                if sj_verdict == gt {
                    single_correct += 1;
                } else if (sj_verdict == "accept_a" || sj_verdict == "accept_b") && (gt != "accept_a" && gt != "accept_b") {
                    single_fp += 1;
                } else if (sj_verdict == "escalate" || sj_verdict == "needs_evidence" || sj_verdict == "merge") && (gt == "accept_a" || gt == "accept_b") {
                    single_fn += 1;
                }
            }

            // Ensemble verdict
            let ens_verdict = &verdict.verdict;
            if ens_verdict == gt {
                ensemble_correct += 1;
            } else if (ens_verdict == "accept_a" || ens_verdict == "accept_b") && (gt != "accept_a" && gt != "accept_b") {
                ensemble_fp += 1;
            } else if (ens_verdict == "escalate" || ens_verdict == "needs_evidence" || ens_verdict == "merge") && (gt == "accept_a" || gt == "accept_b") {
                ensemble_fn += 1;
            }
        } else {
            // Fallback: if ensemble call completely fails, record single as failed too
            single_fn += 1;
            ensemble_fn += 1;
        }

        cleanup_temp_claim_files(project_path, case);
    }

    let total = cases.len();
    let single_fpr = single_fp as f64 / total as f64;
    let ensemble_fpr = ensemble_fp as f64 / total as f64;

    let fpr_reduction_pct = if single_fpr > 0.0 {
        ((single_fpr - ensemble_fpr) / single_fpr) * 100.0
    } else if ensemble_fpr == 0.0 {
        0.0
    } else {
        -100.0 // negative reduction (worse)
    };

    let results = AggregatedEvalResults {
        run_id: format!("eval_run_{}", Local::now().format("%Y-%m-%d")),
        run_at: Local::now().to_rfc3339(),
        total_cases: total,
        single_judge: JudgeStats {
            judge_id: "judge-1".to_string(),
            correct: single_correct,
            false_positive: single_fp,
            false_negative: single_fn,
            fpr: single_fpr,
        },
        ensemble: JudgeStats {
            judge_id: "ensemble".to_string(),
            correct: ensemble_correct,
            false_positive: ensemble_fp,
            false_negative: ensemble_fn,
            fpr: ensemble_fpr,
        },
        fpr_reduction_pct,
        notes: format!("Ensemble reduced false-positive rewrites by {:.1}% vs single-judge", fpr_reduction_pct),
    };

    // Save result to results.jsonl
    let results_file = eval_dir.join("results.jsonl");
    let serialized = serde_json::to_string(&results).unwrap();
    let mut file_content = if results_file.exists() {
        fs::read_to_string(&results_file).unwrap_or_default()
    } else {
        String::new()
    };
    file_content.push_str(&serialized);
    file_content.push('\n');
    let _ = fs::write(&results_file, file_content);

    Ok(results)
}
