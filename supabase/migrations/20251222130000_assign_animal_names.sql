-- Assign Cool Animal Names to Users who are "Unknown"

DO $$
DECLARE
    -- Cool Adjectives
    adjectives text[] := ARRAY[
        'Neon', 'Cyber', 'Cosmic', 'Electric', 'Quantum', 'Hyper', 'Sonic', 'Turbo', 'Plasma', 'Digital',
        'Astral', 'Galactic', 'Vivid', 'Rapid', 'Shadow', 'Ghost', 'Iron', 'Steel', 'Chrome', 'Laser'
    ];
    
    -- Maintain existing "Animal" theme but make them cooler
    animals text[] := ARRAY[
        'Tiger', 'Wolf', 'Eagle', 'Falcon', 'Hawk', 'Panther', 'Lion', 'Bear', 'Fox', 'Shark',
        'Viper', 'Cobra', 'Dragon', 'Phoenix', 'Griffin', 'Raven', 'Jaguar', 'Leopard', 'Lynx', 'Stag'
    ];
    
    user_record RECORD;
    new_name TEXT;
BEGIN
    FOR user_record IN SELECT id FROM profiles WHERE full_name IS NULL OR full_name = '' OR full_name = 'Unknown' LOOP
        -- Generate random name
        -- random() returns 0.0 <= x < 1.0
        -- floor(random() * length) + 1 gives index 1..length
        new_name := adjectives[floor(random() * array_length(adjectives, 1) + 1)] || ' ' || 
                    animals[floor(random() * array_length(animals, 1) + 1)];
                    
        -- Update the profile
        UPDATE profiles SET full_name = new_name WHERE id = user_record.id;
    END LOOP;
END $$;
