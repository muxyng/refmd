use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum TextDiffLineType {
    Added,
    Deleted,
    Context,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TextDiffLine {
    pub line_type: TextDiffLineType,
    pub old_line_number: Option<u32>,
    pub new_line_number: Option<u32>,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TextDiffResult {
    pub file_path: String,
    pub diff_lines: Vec<TextDiffLine>,
    pub old_content: Option<String>,
    pub new_content: Option<String>,
}
