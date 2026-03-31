import { GetStaticProps } from 'next';
import { SitecoreContext } from '@sitecore-jss/sitecore-jss-nextjs';

export default function Home({ layoutData }: { layoutData: any }) {
  return (
    <SitecoreContext layoutData={layoutData}>
      <main>
        <h1>Sitecore Minimal</h1>
      </main>
    </SitecoreContext>
  );
}

export const getStaticProps: GetStaticProps = async () => {
  return { props: { layoutData: {} } };
};
