interface ServerCardProps {
  title: string;
  description: string;
}

export default function ServerCard({ title, description }: ServerCardProps) {
  return (
    <div className="card">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
