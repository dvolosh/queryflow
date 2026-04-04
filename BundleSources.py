import os
import sys
from pathlib import Path

def generate_source_txt(root_dir, output_file):
    root_path = Path(root_dir).resolve()
    
    if not root_path.is_dir():
        print(f"Error: {root_dir} is not a valid directory.")
        sys.exit(1)

    valid_extensions = {'.py', '.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.txt', '.md', '.sh'}
    ignored_dirs = {'node_modules', '.git', '.vscode', 'dist', 'build', '__pycache__'}
    ignored_files = {'package-lock.json'}

    with open(output_file, 'w', encoding='utf-8') as outfile:
        for file_path in root_path.rglob('*'):
            # Check if file is in an ignored directory
            if any(part in ignored_dirs for part in file_path.parts):
                continue
                
            # Skip specific ignored files
            if file_path.name in ignored_files:
                continue

            # Skip directories and the output file itself
            if file_path.is_file() and file_path.suffix in valid_extensions:
                if file_path.resolve() == Path(output_file).resolve():
                    continue

                try:
                    relative_path = file_path.relative_to(root_path)
                    
                    # Write the header
                    outfile.write(f"\n{'='*80}\n")
                    outfile.write(f"FILE: {relative_path}\n")
                    outfile.write(f"{'='*80}\n\n")
                    
                    # Write the content
                    with open(file_path, 'r', encoding='utf-8', errors='replace') as infile:
                        outfile.write(infile.read())
                        outfile.write("\n")
                        
                except Exception as e:
                    print(f"Could not read {file_path}: {e}")

    print(f"Done! Source code compiled into {output_file}")

if __name__ == "__main__":
    # Default to current directory if no path is provided
    target_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    out_name = sys.argv[2] if len(sys.argv) > 2 else "source_compilation.txt"
    
    # If the user asks for help or providing a different kind of flag
    if target_dir in ("-h", "--help"):
        print(f"Usage: python {Path(__file__).name} [directory_path] [output_filename]")
        print("Example: python BundleSources.py . my_code.txt")
        sys.exit(0)

    generate_source_txt(target_dir, out_name)
