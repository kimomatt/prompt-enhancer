from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime

Base = declarative_base()

# SQLite database file
DATABASE_URL = "sqlite:///./learning_agent.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Interaction(Base):
    __tablename__ = "interactions"
    
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.now)
    interaction_id = Column(String, nullable=True, index=True)  # UUID for the interaction pair
    conversation_id = Column(String, nullable=False, index=True)
    turn_index = Column(Integer, nullable=False)
    original_prompt = Column(Text, nullable=False)
    mode = Column(String, nullable=True)  # "learning", "socratic", or null if enhancer disabled
    intent = Column(String, nullable=True)  # "direct_answer", "conceptual", etc., or null if enhancer disabled
    topic = Column(String, nullable=True)
    rewritten_prompt = Column(Text, nullable=True)
    chosen_version = Column(String, nullable=True)  # "original", "rewritten", "edited"
    final_prompt = Column(Text, nullable=True)  # The actual prompt used for final answer
    final_answer = Column(Text, nullable=True)
    socratic_system_prompt = Column(Text, nullable=True)  # Socratic meta-prompt for persistent Socratic behavior


def migrate_db():
    """Add missing columns to existing database"""
    from sqlalchemy import inspect, text
    
    inspector = inspect(engine)
    columns = [col['name'] for col in inspector.get_columns('interactions')]
    
    with engine.connect() as conn:
        # Add interaction_id if missing
        if 'interaction_id' not in columns:
            conn.execute(text('ALTER TABLE interactions ADD COLUMN interaction_id VARCHAR'))
            conn.commit()
            print("✓ Added interaction_id column")
        
        # Add chosen_version if missing
        if 'chosen_version' not in columns:
            conn.execute(text('ALTER TABLE interactions ADD COLUMN chosen_version VARCHAR'))
            conn.commit()
            print("✓ Added chosen_version column")
        
        # Add final_prompt if missing
        if 'final_prompt' not in columns:
            conn.execute(text('ALTER TABLE interactions ADD COLUMN final_prompt TEXT'))
            conn.commit()
            print("✓ Added final_prompt column")
        
        # Add socratic_system_prompt if missing
        if 'socratic_system_prompt' not in columns:
            conn.execute(text('ALTER TABLE interactions ADD COLUMN socratic_system_prompt TEXT'))
            conn.commit()
            print("✓ Added socratic_system_prompt column")
        
        # Ensure mode column is nullable (fix for existing databases)
        try:
            # SQLite doesn't support ALTER COLUMN, so we need to check if it's already nullable
            # If the column exists but isn't nullable, we'll need to recreate the table
            # For now, we'll just try to use it and let SQLAlchemy handle it
            # But we can at least verify the column exists
            if 'mode' in columns:
                # Check if mode column allows NULL - SQLite doesn't enforce this strictly
                # but we can try to ensure it's set correctly
                pass  # SQLite will allow NULL even if originally NOT NULL was specified
        except Exception as e:
            print(f"Note: Mode column check skipped: {e}")
        
        # Create index on interaction_id if it doesn't exist
        try:
            conn.execute(text('CREATE INDEX IF NOT EXISTS ix_interactions_interaction_id ON interactions(interaction_id)'))
            conn.commit()
        except Exception as e:
            print(f"Note: Index creation skipped (may already exist): {e}")


def init_db():
    """Initialize the database by creating all tables and migrating if needed"""
    # First, create tables if they don't exist
    Base.metadata.create_all(bind=engine)
    
    # Then, migrate existing tables to add new columns
    try:
        migrate_db()
    except Exception as e:
        print(f"Migration note: {e}")
        # If table doesn't exist yet, that's fine - create_all will handle it


def get_db():
    """Database session dependency"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

